/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugConfigurationManager.ts
// The launch configurations of the window: one launch per folder (its `.diode/launch.json`, upstream
// `.vscode/launch.json`), the `launch` block of a `.code-workspace` file, and `launch` of the user settings. The
// selected configuration is remembered per workspace under upstream's keys. Not here yet, each with its task: the
// configuration providers and the dynamic configurations of extensions (#1139), the launch.json schema
// (IntelliSense in launch.json), choosing a debugger for a new launch.json (#1156: it is created with an empty
// `configurations`). Deviations: there is no last active folder (one folder per window); a `.code-workspace` file
// without a `launch` block is opened as is, nothing is written into it.

import { Emitter, type Event } from "../../../../base/common/event.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { LAUNCH_FILE_NAME } from "../../../../platform/configuration/common/workspaceSettings.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IFileService } from "../../../../platform/files/common/files.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import type {
    IWorkspaceContextService,
    IWorkspaceFolder,
} from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { workspaceConfigFilePath } from "../../../../platform/workspace/common/workspaceConfigFolder.ts";
import { positionAt } from "../../tasks/common/tasksJsonEdits.ts";
import type {
    IAdapterManager,
    ICompound,
    IConfig,
    IConfigPresentation,
    IConfigurationManager,
    IGlobalConfig,
    ILaunch,
    IOpenConfigFileResult,
} from "../common/debug.ts";
import { isDebugConfig } from "../common/debug.ts";
import { initialConfigurationContent } from "../common/debugger.ts";
import { getEffectiveConfigForPlatform, getVisibleAndSorted } from "../common/debugUtils.ts";

export const LAUNCH_JSON_PATH = workspaceConfigFilePath(LAUNCH_FILE_NAME);

const DEBUG_SELECTED_CONFIG_NAME_KEY: IStateDescriptor<string | undefined> = {
    key: "debug.selectedconfigname",
    scope: "workspace",
    default: undefined,
};
const DEBUG_SELECTED_ROOT: IStateDescriptor<string | undefined> = {
    key: "debug.selectedroot",
    scope: "workspace",
    default: undefined,
};

/** What the configuration manager talks to; the DI module builds it from the workbench services. */
export interface IConfigurationManagerPorts {
    readonly configuration: Pick<IConfigurationService, "inspect" | "get" | "onDidChangeConfiguration">;
    readonly workspace: Pick<
        IWorkspaceContextService,
        "getWorkspace" | "getWorkbenchState" | "onDidChangeWorkspaceFolders"
    >;
    readonly state: Pick<IStateService, "get" | "store" | "remove" | "onDidOpenWorkspace">;
    readonly contextKeys: Pick<ContextKeyService, "set" | "reset">;
    readonly files: Pick<IFileService, "readFile" | "writeFile" | "exists" | "createFolder">;
    /** Opens a file in the editor; `line` (0-based) puts the caret at the start of that line's text. */
    readonly openEditor: (resource: Uri, options: { preserveFocus: boolean; line?: number }) => Promise<void>;
    /** The user settings file, which holds the user `launch`. */
    readonly userSettings: { readonly resource: Uri; readonly open: () => Promise<void> };
}

export class ConfigurationManager implements IConfigurationManager {
    private launches!: AbstractLaunch[];
    private selectedName: string | undefined;
    private selectedLaunch: ILaunch | undefined;
    private getSelectedConfig: () => Promise<IConfig | undefined> = () => Promise.resolve(undefined);
    private readonly toDispose = new DisposableStore();
    private readonly onDidSelectConfigurationNameEmitter = this.toDispose.add(new Emitter<void>());

    public constructor(
        private readonly adapterManager: IAdapterManager,
        private readonly ports: IConfigurationManagerPorts,
    ) {
        this.initLaunches();
        this.registerListeners();
        this.restoreSelection();
    }

    /** Upstream reads the stored selection once, in its constructor; ours again when the window opens a workspace. */
    private restoreSelection(): void {
        const previousSelectedRoot = this.ports.state.get(DEBUG_SELECTED_ROOT);
        const previousSelectedLaunch = this.launches.find((l) => l.uri.toString() === previousSelectedRoot);
        const previousSelectedName = this.ports.state.get(DEBUG_SELECTED_CONFIG_NAME_KEY);
        if (previousSelectedLaunch?.getConfigurationNames().length) {
            void this.selectConfiguration(previousSelectedLaunch, previousSelectedName);
        } else {
            void this.selectConfiguration(undefined, previousSelectedName);
        }
    }

    public getAllConfigurations(): { launch: ILaunch; name: string; presentation?: IConfigPresentation }[] {
        const all: { launch: ILaunch; name: string; presentation?: IConfigPresentation }[] = [];
        for (const l of this.launches) {
            for (const name of l.getConfigurationNames()) {
                const config = l.getConfiguration(name) ?? l.getCompound(name);
                if (config) {
                    all.push({ launch: l, name, presentation: config.presentation });
                }
            }
        }

        return getVisibleAndSorted(all);
    }

    private registerListeners(): void {
        this.toDispose.add(
            this.ports.workspace.onDidChangeWorkspaceFolders(() => {
                this.initLaunches();
                void this.selectConfiguration(undefined);
            }),
        );
        this.toDispose.add(
            this.ports.configuration.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration("launch")) {
                    // A change happen in the launch.json. If there is already a launch configuration selected, do not change the selection.
                    void this.selectConfiguration(undefined);
                }
            }),
        );
        this.toDispose.add(
            this.ports.state.onDidOpenWorkspace(() => {
                this.restoreSelection();
            }),
        );
    }

    private initLaunches(): void {
        const workspace = this.ports.workspace;
        this.launches = workspace.getWorkspace().folders.map((folder) => new Launch(this, folder, this.ports));
        if (workspace.getWorkbenchState() === "workspace") {
            this.launches.push(new WorkspaceLaunch(this, this.ports));
        }
        // Upstream selects again here when the selected launch is gone; its only caller after the constructor
        // selects again anyway.
        this.launches.push(new UserLaunch(this, this.ports));
    }

    public getLaunches(): ILaunch[] {
        return this.launches;
    }

    public getLaunch(workspaceUri: Uri | undefined): ILaunch | undefined {
        if (!Uri.isUri(workspaceUri)) {
            return undefined;
        }

        return this.launches.find((l) => l.workspace?.uri.toString() === workspaceUri.toString());
    }

    public get selectedConfiguration(): IConfigurationManager["selectedConfiguration"] {
        return {
            launch: this.selectedLaunch,
            name: this.selectedName,
            getConfig: this.getSelectedConfig,
            type: undefined,
        };
    }

    public get onDidSelectConfiguration(): Event<void> {
        return this.onDidSelectConfigurationNameEmitter.event;
    }

    public selectConfiguration(launch: ILaunch | undefined, name?: string, config?: IConfig): Promise<void> {
        if (typeof launch === "undefined") {
            // Upstream starts from the last active folder; a window has one.
            launch = this.getLaunch(this.ports.workspace.getWorkspace().folders.at(0)?.uri);
            if (!launch || launch.getConfigurationNames().length === 0) {
                launch = this.launches.find((l) => l.getConfigurationNames().length > 0) ?? launch ?? this.launches[0];
            }
        }

        const previousLaunch = this.selectedLaunch;
        const previousName = this.selectedName;
        this.selectedLaunch = launch;

        // There is always a launch to select: the one of the user settings.
        this.ports.state.store(DEBUG_SELECTED_ROOT, launch.uri.toString());

        const names = launch.getConfigurationNames();
        this.getSelectedConfig = () => {
            const selected = this.selectedName ? launch.getConfiguration(this.selectedName) : undefined;
            return Promise.resolve(selected ?? config);
        };

        let type = config?.type;
        if (name && names.includes(name)) {
            this.setSelectedLaunchName(name);
        } else if (!this.selectedName || !names.includes(this.selectedName)) {
            // We could not find the configuration to select, pick the first one, or reset the selection if there is no launch configuration
            const nameToSet = names.length ? names[0] : undefined;
            this.setSelectedLaunchName(nameToSet);
        }

        if (!config && this.selectedName) {
            config = launch.getConfiguration(this.selectedName);
            type = config?.type;
        }

        if (type) {
            this.ports.contextKeys.set("debugConfigurationType", type);
        } else {
            this.ports.contextKeys.reset("debugConfigurationType");
        }

        if (this.selectedLaunch !== previousLaunch || this.selectedName !== previousName) {
            this.onDidSelectConfigurationNameEmitter.fire();
        }
        return Promise.resolve();
    }

    private setSelectedLaunchName(selectedName: string | undefined): void {
        this.selectedName = selectedName;

        if (this.selectedName) {
            this.ports.state.store(DEBUG_SELECTED_CONFIG_NAME_KEY, this.selectedName);
        } else {
            this.ports.state.remove(DEBUG_SELECTED_CONFIG_NAME_KEY);
        }
    }

    /** Upstream's debugger and its configuration providers fill a new launch.json; without a type it is empty (#1156). */
    public async getInitialConfigurationContent(type: string | undefined): Promise<string> {
        const dbg = type === undefined ? undefined : this.adapterManager.getDebugger(type);
        const content = dbg ? await dbg.getInitialConfigurationContent() : initialConfigurationContent([]);
        // fix formatting
        if (this.ports.configuration.get<boolean>("editor.insertSpaces") === true) {
            const tabSize = this.ports.configuration.get<number>("editor.tabSize") ?? 4;
            return content.replace(/\t/g, " ".repeat(tabSize));
        }
        return content;
    }

    public dispose(): void {
        this.toDispose.dispose();
    }
}

abstract class AbstractLaunch implements ILaunch {
    public abstract readonly uri: Uri;
    public abstract readonly name: string;
    public abstract readonly workspace: IWorkspaceFolder | undefined;
    protected abstract getConfig(): IGlobalConfig | undefined;
    public abstract openConfigFile(options: {
        preserveFocus: boolean;
        type?: string;
        suppressInitialConfigs?: boolean;
    }): Promise<IOpenConfigFileResult>;

    public constructor(protected readonly configurationManager: ConfigurationManager) {}

    public getCompound(name: string): ICompound | undefined {
        return this.getDeduplicatedConfig().compounds.find((compound) => compound.name === name);
    }

    public getConfigurationNames(ignoreCompoundsAndPresentation = false): string[] {
        const config = this.getDeduplicatedConfig();
        const configurations: (IConfig | ICompound)[] = [...config.configurations];
        if (ignoreCompoundsAndPresentation) {
            return configurations.map((c) => c.name);
        }

        configurations.push(
            ...config.compounds.filter(
                (compound) => Array.isArray(compound.configurations) && compound.configurations.length > 0,
            ),
        );
        const resolved = configurations.map((c) => (isDebugConfig(c) ? getEffectiveConfigForPlatform(c) : c));
        return getVisibleAndSorted(resolved).map((c) => c.name);
    }

    public getConfiguration(name: string): IConfig | undefined {
        const configuration = this.getDeduplicatedConfig().configurations.find((c) => c.name === name);
        if (!configuration) {
            return;
        }

        // We need to clone the configuration in order to be able to make changes to it #42198
        return { ...getEffectiveConfigForPlatform(structuredClone(configuration)), __configurationTarget: this.target };
    }

    protected abstract readonly target: NonNullable<IConfig["__configurationTarget"]>;

    public readonly hidden: boolean = false;

    /** Upstream's: the named entries, a repeated name numbered; without a config, none (upstream: `undefined`). */
    private getDeduplicatedConfig(): Pick<IGlobalConfig, "compounds" | "configurations"> {
        const original = this.getConfig();
        const compounds = Array.isArray(original?.compounds) ? original.compounds.filter(isNamed) : [];
        const configurations = Array.isArray(original?.configurations) ? original.configurations.filter(isNamed) : [];
        return {
            compounds: distinguishConfigsByName(compounds),
            configurations: distinguishConfigsByName(configurations),
        };
    }
}

/** launch.json is hand-written: an entry may be anything. */
function isNamed(candidate: unknown): boolean {
    return (
        typeof candidate === "object" &&
        candidate !== null &&
        typeof (candidate as { name?: unknown }).name === "string"
    );
}

function distinguishConfigsByName<T extends { name: string }>(things: readonly T[]): T[] {
    const seen = new Map<string, number>();
    return things.map((thing) => {
        const no = seen.get(thing.name) ?? 0;
        seen.set(thing.name, no + 1);
        return no === 0 ? thing : { ...thing, name: `${thing.name} (${no})` };
    });
}

class Launch extends AbstractLaunch {
    protected readonly target = "workspaceFolder" as const;

    public constructor(
        configurationManager: ConfigurationManager,
        public readonly workspace: IWorkspaceFolder,
        private readonly ports: IConfigurationManagerPorts,
    ) {
        super(configurationManager);
    }

    public get uri(): Uri {
        return Uri.joinPath(this.workspace.uri, LAUNCH_JSON_PATH);
    }

    public get name(): string {
        return this.workspace.name;
    }

    /** The folder layer of a `.code-workspace` window; in a folder window the folder's files are the workspace layer. */
    protected getConfig(): IGlobalConfig | undefined {
        const inspected = this.ports.configuration.inspect<IGlobalConfig>("launch");
        return this.ports.workspace.getWorkbenchState() === "workspace"
            ? inspected.workspaceFolder
            : inspected.workspace;
    }

    public async openConfigFile({
        preserveFocus,
        type,
    }: {
        preserveFocus: boolean;
        type?: string;
        suppressInitialConfigs?: boolean;
    }): Promise<IOpenConfigFileResult> {
        const resource = this.uri;
        let created = false;
        let content: string;
        try {
            const fileContent = await this.ports.files.readFile(resource);
            content = new TextDecoder().decode(fileContent.value);
        } catch {
            // launch.json not found: create one by collecting launch configs from debugConfigProviders
            content = await this.configurationManager.getInitialConfigurationContent(type);
            created = true; // pin only if config file is created #8727
            try {
                const folder = Uri.joinPath(resource, "..");
                if (!(await this.ports.files.exists(folder))) {
                    await this.ports.files.createFolder(folder);
                }
                await this.ports.files.writeFile(resource, new TextEncoder().encode(content));
            } catch (error) {
                throw new Error(
                    `Unable to create 'launch.json' file inside the '.diode' folder (${(error as Error).message}).`,
                    { cause: error },
                );
            }
        }

        const index = content.indexOf(`"${this.configurationManager.selectedConfiguration.name ?? ""}"`);
        const line = index < 0 ? 0 : positionAt(content, index).line;

        await this.ports.openEditor(resource, { preserveFocus, line: line > 0 ? line : undefined });
        return { opened: true, created };
    }
}

class WorkspaceLaunch extends AbstractLaunch {
    protected readonly target = "workspace" as const;

    public constructor(
        configurationManager: ConfigurationManager,
        private readonly ports: IConfigurationManagerPorts,
    ) {
        super(configurationManager);
    }

    public get workspace(): undefined {
        return undefined;
    }

    public get uri(): Uri {
        // Only a `.code-workspace` window has this launch.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return this.ports.workspace.getWorkspace().configuration!;
    }

    public readonly name: string = "workspace";

    protected getConfig(): IGlobalConfig | undefined {
        return this.ports.configuration.inspect<IGlobalConfig>("launch").workspace;
    }

    public async openConfigFile({ preserveFocus }: { preserveFocus: boolean }): Promise<IOpenConfigFileResult> {
        await this.ports.openEditor(this.uri, { preserveFocus });
        return { opened: true, created: false };
    }
}

class UserLaunch extends AbstractLaunch {
    protected readonly target = "user" as const;

    public constructor(
        configurationManager: ConfigurationManager,
        private readonly ports: IConfigurationManagerPorts,
    ) {
        super(configurationManager);
    }

    public get workspace(): undefined {
        return undefined;
    }

    public get uri(): Uri {
        return this.ports.userSettings.resource;
    }

    public readonly name: string = "user settings";

    public override readonly hidden: boolean = true;

    protected getConfig(): IGlobalConfig | undefined {
        // Upstream's `userValue` is the profile's settings over the default profile's.
        const inspected = this.ports.configuration.inspect<IGlobalConfig>("launch");
        return inspected.profile ?? inspected.user;
    }

    public async openConfigFile(): Promise<IOpenConfigFileResult> {
        await this.ports.userSettings.open();
        return { opened: true, created: false };
    }
}
