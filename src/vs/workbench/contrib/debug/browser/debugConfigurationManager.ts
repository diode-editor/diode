/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugConfigurationManager.ts
// The launch configurations of the window: one launch per folder (its `.diode/launch.json`, upstream
// `.vscode/launch.json`), the `launch` block of a `.code-workspace` file, and `launch` of the user settings. The
// selected configuration is remembered per workspace under upstream's keys. The configuration providers of extensions
// resolve a configuration before and after its variables are substituted, and the `Initial` ones fill a new
// launch.json, whose debugger is guessed when none is given. The `Dynamic` ones are asked lazily, when the user opens
// their type (`onDebugDynamicConfigurations` activates the extension only then); a picked one is selected and
// remembered among the recent dynamic configurations. IntelliSense in launch.json is not here: the builtin
// diode-settings extension reads the debuggers' `configurationAttributes` from their manifests. Deviations: there is no
// last active folder (one folder per window); a `.code-workspace` file without a `launch` block is opened as is,
// nothing is written into it; the picker of dynamic configurations has no "Edit Debug Configuration in launch.json"
// button (the picker has no item buttons).

import { distinct } from "../../../../base/common/arrays.ts";
import {
    CancellationTokenNone,
    CancellationTokenSource,
    type ICancellationToken,
} from "../../../../base/common/cancellation.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
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
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import type { IExtensionService } from "../../../services/extensions/common/extensions.ts";
import { positionAt } from "../../tasks/common/tasksJsonEdits.ts";
import {
    DebugConfigurationProviderTriggerKind,
    type IAdapterManager,
    type ICompound,
    type IConfig,
    type IConfigPresentation,
    type IConfigurationManager,
    type IDebugConfigurationProvider,
    type IDebugger,
    type IDynamicConfigurationPick,
    type IDynamicConfigurationProvider,
    type IGlobalConfig,
    type ILaunch,
    type IOpenConfigFileResult,
    isDebugConfig,
} from "../common/debug.ts";
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
// Debug type is only stored if a dynamic configuration is used for better restore
const DEBUG_SELECTED_TYPE: IStateDescriptor<string | undefined> = {
    key: "debug.selectedtype",
    scope: "workspace",
    default: undefined,
};
const DEBUG_RECENT_DYNAMIC_CONFIGURATIONS: IStateDescriptor<{ name: string; type: string }[]> = {
    key: "debug.recentdynamicconfigurations",
    scope: "workspace",
    default: [],
};
const ON_DEBUG_DYNAMIC_CONFIGURATIONS_NAME = "onDebugDynamicConfigurations";

type IDynamicPickItem = IDynamicConfigurationPick & QuickPickItem;

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
    /** Their activation events and `contributes.debuggers` name the types with dynamic configurations. */
    readonly extensions: Pick<IExtensionService, "extensions" | "whenInstalledExtensionsRegistered">;
    /**
     * Upstream's busy quick pick: open at once, filled when `items` come. A rejected `items` is logged and closes
     * the picker; `undefined` — cancelled.
     */
    readonly pickLate: <T extends QuickPickItem>(
        placeholder: string,
        items: Promise<readonly T[]>,
    ) => Promise<T | undefined>;
}

export class ConfigurationManager implements IConfigurationManager {
    private launches!: AbstractLaunch[];
    private selectedName: string | undefined;
    private selectedLaunch: ILaunch | undefined;
    private selectedType: string | undefined;
    private selectedDynamic = false;
    // Set by the selection in the constructor.
    private getSelectedConfig!: () => Promise<IConfig | undefined>;
    private readonly toDispose = new DisposableStore();
    private readonly onDidSelectConfigurationNameEmitter = this.toDispose.add(new Emitter<void>());
    private readonly onDidChangeConfigurationProvidersEmitter = this.toDispose.add(new Emitter<void>());
    private readonly configProviders: IDebugConfigurationProvider[] = [];

    public constructor(
        private readonly adapterManager: IAdapterManager,
        private readonly ports: IConfigurationManagerPorts,
    ) {
        this.initLaunches();
        this.registerListeners();
        this.restoreSelection();
    }

    public get onDidChangeConfigurationProviders(): Event<void> {
        return this.onDidChangeConfigurationProvidersEmitter.event;
    }

    public registerDebugConfigurationProvider(debugConfigurationProvider: IDebugConfigurationProvider): IDisposable {
        this.configProviders.push(debugConfigurationProvider);
        this.onDidChangeConfigurationProvidersEmitter.fire();
        return {
            dispose: () => {
                this.unregisterDebugConfigurationProvider(debugConfigurationProvider);
                this.onDidChangeConfigurationProvidersEmitter.fire();
            },
        };
    }

    private unregisterDebugConfigurationProvider(debugConfigurationProvider: IDebugConfigurationProvider): void {
        const ix = this.configProviders.indexOf(debugConfigurationProvider);
        if (ix >= 0) {
            this.configProviders.splice(ix, 1);
        }
    }

    /** If no trigger kind is given, `Initial` is assumed. */
    public hasDebugConfigurationProvider(
        debugType: string,
        triggerKind: DebugConfigurationProviderTriggerKind = DebugConfigurationProviderTriggerKind.Initial,
    ): boolean {
        // check if there are providers for the given type that contribute a provideDebugConfigurations method
        return this.configProviders.some(
            (p) => p.provideDebugConfigurations !== undefined && p.type === debugType && p.triggerKind === triggerKind,
        );
    }

    public async resolveConfigurationByProviders(
        folderUri: Uri | undefined,
        type: string | undefined,
        config: IConfig,
        token: ICancellationToken,
    ): Promise<IConfig | null | undefined> {
        const resolveDebugConfigurationForType = async (
            forType: string | undefined,
            forConfig: IConfig | null | undefined,
        ): Promise<IConfig | null | undefined> => {
            if (forType !== "*") {
                await this.adapterManager.activateDebuggers("onDebugResolve", forType);
            }

            let result = forConfig;
            for (const p of this.configProviders) {
                const resolve = p.resolveDebugConfiguration?.bind(p);
                if (p.type === forType && resolve && result) {
                    result = await resolve(folderUri, result, token);
                }
            }

            return result;
        };

        // launch.json is hand-written: a configuration may have no type.
        let resolvedType = (config.type as string | undefined) ?? type;
        let result: IConfig | null | undefined = config;
        for (const seen = new Set<string | undefined>(); result && !seen.has(resolvedType); ) {
            seen.add(resolvedType);
            result = await resolveDebugConfigurationForType(resolvedType, result);
            result = await resolveDebugConfigurationForType("*", result);
            resolvedType = result?.type ?? type;
        }

        return result;
    }

    public async resolveDebugConfigurationWithSubstitutedVariables(
        folderUri: Uri | undefined,
        type: string | undefined,
        config: IConfig,
        token: ICancellationToken,
    ): Promise<IConfig | null | undefined> {
        // pipe the config through the promises sequentially. Append at the end the '*' types
        const resolversOf = (forType: string | undefined) =>
            this.configProviders
                .filter((p) => p.type === forType)
                .map((p) => p.resolveDebugConfigurationWithSubstitutedVariables?.bind(p))
                .filter((resolve) => resolve !== undefined);
        const resolvers = resolversOf(type).concat(resolversOf("*"));

        let result: IConfig | null | undefined = config;
        for (const resolve of resolvers) {
            // If any provider returned undefined or null make sure to respect that and do not pass the result to more resolver
            if (!result) break;
            result = await resolve(folderUri, result, token);
        }

        return result;
    }

    public async provideDebugConfigurations(
        folderUri: Uri | undefined,
        type: string,
        token: ICancellationToken,
    ): Promise<IConfig[]> {
        await this.adapterManager.activateDebuggers("onDebugInitialConfigurations");
        const results = await Promise.all(
            this.configProviders
                .filter((p) => p.type === type && p.triggerKind === DebugConfigurationProviderTriggerKind.Initial)
                .map((p) => p.provideDebugConfigurations?.bind(p))
                .filter((provide) => provide !== undefined)
                .map((provide) => provide(folderUri, token)),
        );

        return results.flat();
    }

    public async getDynamicProviders(): Promise<IDynamicConfigurationProvider[]> {
        const extensions = this.ports.extensions;
        await extensions.whenInstalledExtensionsRegistered();
        const debugDynamicExtensionsTypes = new Set<string>();
        for (const e of extensions.extensions) {
            const explicitTypes: string[] = [];
            let hasGenericEvent = false;
            for (const event of e.manifest.activationEvents ?? []) {
                if (event === ON_DEBUG_DYNAMIC_CONFIGURATIONS_NAME) {
                    hasGenericEvent = true;
                } else if (event.startsWith(`${ON_DEBUG_DYNAMIC_CONFIGURATIONS_NAME}:`)) {
                    explicitTypes.push(event.slice(ON_DEBUG_DYNAMIC_CONFIGURATIONS_NAME.length + 1));
                }
            }

            if (explicitTypes.length) {
                explicitTypes.forEach((t) => debugDynamicExtensionsTypes.add(t));
            } else if (hasGenericEvent) {
                const debuggerType = firstDebuggerType(e.manifest.contributes?.debuggers);
                if (debuggerType) {
                    debugDynamicExtensionsTypes.add(debuggerType);
                }
            }
        }

        for (const configProvider of this.configProviders) {
            if (configProvider.triggerKind === DebugConfigurationProviderTriggerKind.Dynamic) {
                debugDynamicExtensionsTypes.add(configProvider.type);
            }
        }

        return [...debugDynamicExtensionsTypes].map((type) => ({
            // Upstream asserts the label: a type without a debugger shows as its name.
            label: this.adapterManager.getDebuggerLabel(type) ?? type,
            type,
            getProvider: async () => {
                await this.adapterManager.activateDebuggers(ON_DEBUG_DYNAMIC_CONFIGURATIONS_NAME, type);
                return this.dynamicProvider(type);
            },
            pick: async () => {
                // Do a late 'onDebugDynamicConfigurationsName' activation so extensions are not activated too early #108578
                await this.adapterManager.activateDebuggers(ON_DEBUG_DYNAMIC_CONFIGURATIONS_NAME, type);
                const token = new CancellationTokenSource();
                try {
                    return await this.ports.pickLate(
                        "Select Launch Configuration",
                        this.getDynamicConfigurationsByType(type, token.token),
                    );
                } finally {
                    token.cancel();
                }
            },
        }));
    }

    private dynamicProvider(type: string): IDebugConfigurationProvider | undefined {
        return this.configProviders.find(
            (p) =>
                p.type === type &&
                p.triggerKind === DebugConfigurationProviderTriggerKind.Dynamic &&
                p.provideDebugConfigurations !== undefined,
        );
    }

    public async getDynamicConfigurationsByType(
        type: string,
        token: ICancellationToken = CancellationTokenNone,
    ): Promise<IDynamicPickItem[]> {
        // Do a late 'onDebugDynamicConfigurationsName' activation so extensions are not activated too early #108578
        await this.adapterManager.activateDebuggers(ON_DEBUG_DYNAMIC_CONFIGURATIONS_NAME, type);

        const provider = this.dynamicProvider(type);
        const provide = provider?.provideDebugConfigurations?.bind(provider);
        if (!provide) return [];
        const picks = this.getLaunches().map(async (launch) => {
            const configurations = await provide(launch.workspace?.uri, token);
            return configurations.map((config) => ({ label: config.name, description: launch.name, config, launch }));
        });

        return (await Promise.all(picks)).flat();
    }

    public getRecentDynamicConfigurations(): { name: string; type: string }[] {
        return this.ports.state.get(DEBUG_RECENT_DYNAMIC_CONFIGURATIONS);
    }

    /** Upstream reads the stored selection once, in its constructor; ours again when the window opens a workspace. */
    private restoreSelection(): void {
        const previousSelectedRoot = this.ports.state.get(DEBUG_SELECTED_ROOT);
        const previousSelectedLaunch = this.launches.find((l) => l.uri.toString() === previousSelectedRoot);
        const previousSelectedName = this.ports.state.get(DEBUG_SELECTED_CONFIG_NAME_KEY);
        const previousSelectedType = this.ports.state.get(DEBUG_SELECTED_TYPE);
        const dynamicConfig = previousSelectedType ? { type: previousSelectedType } : undefined;
        if (previousSelectedLaunch?.getConfigurationNames().length) {
            void this.selectConfiguration(previousSelectedLaunch, previousSelectedName, undefined, dynamicConfig);
        } else {
            void this.selectConfiguration(undefined, previousSelectedName, undefined, dynamicConfig);
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
                // Stryker disable next-line ConditionalExpression: equivalent, selecting again over an unchanged launch section changes nothing, fires nothing and stores nothing
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
            type: this.selectedType,
        };
    }

    public get onDidSelectConfiguration(): Event<void> {
        return this.onDidSelectConfigurationNameEmitter.event;
    }

    public async selectConfiguration(
        launch: ILaunch | undefined,
        name?: string,
        config?: IConfig,
        dynamicConfig?: { type?: string },
    ): Promise<void> {
        if (typeof launch === "undefined") {
            // Upstream starts from the last active folder; a window has one.
            launch = this.getLaunch(this.ports.workspace.getWorkspace().folders.at(0)?.uri);
            if (!launch || launch.getConfigurationNames().length === 0) {
                launch = this.launches.find((l) => l.getConfigurationNames().length > 0) ?? launch ?? this.launches[0];
            }
        }

        const previousLaunch = this.selectedLaunch;
        const previousName = this.selectedName;
        const previousSelectedDynamic = this.selectedDynamic;
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
        } else if (dynamicConfig?.type) {
            // We could not find the previously used name and config is not passed. We should get all dynamic configurations from providers
            // And potentially auto select the previously used dynamic configuration #96293
            const dynamicType = dynamicConfig.type;
            type = dynamicType;
            if (!config) {
                const providers = (await this.getDynamicProviders()).filter((p) => p.type === dynamicType);
                this.getSelectedConfig = async () => {
                    const activatedProviders = await Promise.all(providers.map((p) => p.getProvider()));
                    const provider = activatedProviders.at(0);
                    if (provider?.provideDebugConfigurations && launch.workspace) {
                        const dynamicConfigs = await provider.provideDebugConfigurations(
                            launch.workspace.uri,
                            CancellationTokenNone,
                        );
                        return dynamicConfigs.find((c) => c.name === name);
                    }

                    return undefined;
                };
            }
            this.setSelectedLaunchName(name);

            if (name) {
                // We need to store the recently used dynamic configurations to be able to show them in UI #110009
                const recentDynamicProviders = [{ name, type: dynamicType }, ...this.getRecentDynamicConfigurations()];
                this.ports.state.store(
                    DEBUG_RECENT_DYNAMIC_CONFIGURATIONS,
                    distinct(recentDynamicProviders, (t) => `${t.name} : ${t.type}`),
                );
            }
        } else if (!this.selectedName || !names.includes(this.selectedName)) {
            // We could not find the configuration to select, pick the first one, or reset the selection if there is no launch configuration
            const nameToSet = names.length ? names[0] : undefined;
            this.setSelectedLaunchName(nameToSet);
        }

        if (!config && this.selectedName) {
            config = launch.getConfiguration(this.selectedName);
            type = config?.type;
        }

        this.selectedType = dynamicConfig?.type ?? config?.type;
        this.selectedDynamic = !!dynamicConfig;
        // Only store the selected type if we are having a dynamic configuration. Otherwise restoring this configuration from storage might be misindentified as a dynamic configuration
        if (dynamicConfig) {
            this.ports.state.store(DEBUG_SELECTED_TYPE, this.selectedType);
        } else {
            this.ports.state.remove(DEBUG_SELECTED_TYPE);
        }

        if (type) {
            this.ports.contextKeys.set("debugConfigurationType", type);
        } else {
            this.ports.contextKeys.reset("debugConfigurationType");
        }

        if (
            this.selectedLaunch !== previousLaunch ||
            this.selectedName !== previousName ||
            previousSelectedDynamic !== this.selectedDynamic
        ) {
            this.onDidSelectConfigurationNameEmitter.fire();
        }
    }

    private setSelectedLaunchName(selectedName: string | undefined): void {
        this.selectedName = selectedName;

        if (this.selectedName) {
            this.ports.state.store(DEBUG_SELECTED_CONFIG_NAME_KEY, this.selectedName);
        } else {
            this.ports.state.remove(DEBUG_SELECTED_CONFIG_NAME_KEY);
        }
    }

    /**
     * Upstream's: the debugger's `initialConfigurations` and the configurations of its `Initial` providers fill a new
     * launch.json; without a type the debugger is guessed, and a dynamic configuration picked there is the only one.
     * `''` — there is no debugger or the user cancelled. A type without a debugger gets an empty skeleton (upstream's
     * gets nothing).
     */
    public async getInitialConfigurationContent(
        folderUri: Uri | undefined,
        type: string | undefined,
        useInitialConfigs: boolean,
        token: ICancellationToken = CancellationTokenNone,
    ): Promise<string> {
        let content: string;
        if (type === undefined) {
            const adapter = await this.adapterManager.guessDebugger(true);
            if (!adapter) return "";
            content = adapter.withConfig
                ? await adapter.debugger.getInitialConfigurationContent([adapter.withConfig.config])
                : await this.initialContentOf(adapter.debugger, folderUri, useInitialConfigs, token);
        } else {
            const dbg = this.adapterManager.getDebugger(type);
            content = dbg
                ? await this.initialContentOf(dbg, folderUri, useInitialConfigs, token)
                : initialConfigurationContent([]);
        }
        // fix formatting
        if (this.ports.configuration.get<boolean>("editor.insertSpaces") === true) {
            const tabSize = this.ports.configuration.get<number>("editor.tabSize") ?? 4;
            return content.replace(/\t/g, " ".repeat(tabSize));
        }
        return content;
    }

    private async initialContentOf(
        dbg: IDebugger,
        folderUri: Uri | undefined,
        useInitialConfigs: boolean,
        token: ICancellationToken,
    ): Promise<string> {
        const initialConfigs = useInitialConfigs
            ? await this.provideDebugConfigurations(folderUri, dbg.type, token)
            : [];
        return await dbg.getInitialConfigurationContent(initialConfigs);
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
        return {
            compounds: distinguishConfigsByName(namedEntries<ICompound>(original?.compounds)),
            configurations: distinguishConfigsByName(namedEntries<IConfig>(original?.configurations)),
        };
    }
}

/** Upstream's `contributes.debuggers[0].type`; the manifest is the extension's, any shape. */
function firstDebuggerType(debuggers: unknown): string | undefined {
    const type = Array.isArray(debuggers) ? (debuggers[0] as { type?: unknown } | undefined)?.type : undefined;
    return typeof type === "string" ? type : undefined;
}

/** launch.json is hand-written: a section may be anything, and so may its entries. */
function namedEntries<T>(section: unknown): T[] {
    const isNamed = (entry: unknown): boolean => typeof (entry as { name?: unknown } | null)?.name === "string";
    return Array.isArray(section) ? ((section as unknown[]).filter(isNamed) as T[]) : [];
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
        suppressInitialConfigs,
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
            content = await this.configurationManager.getInitialConfigurationContent(
                this.workspace.uri,
                type,
                !suppressInitialConfigs,
            );
            if (!content) {
                // Cancelled
                return { opened: false, created: false };
            }
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

        // As upstream, without a selection this looks for `"undefined"`.
        const index = content.indexOf(`"${String(this.configurationManager.selectedConfiguration.name)}"`);
        // Stryker disable next-line EqualityOperator: equivalent, offset 0 is on line 0 either way
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

    public readonly workspace = undefined;

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

    public readonly workspace = undefined;

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
