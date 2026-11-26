// Upstream's `BaseConfigurationResolverService`. Differences: the `inputs` section is passed by the caller (our
// tasks.json and launch.json are not configuration sections), there are no contributed variables
// (`contributeVariable`) and no platform keys (`windows`/`osx`/`linux`) in the resolved object.

import * as paths from "node:path";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IStateDescriptor,
    type IStateStore,
    StateServiceDIToken,
} from "../../../../platform/state/common/iStateService.ts";
import type {
    IWorkspaceContextService,
    IWorkspaceFolder,
} from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import {
    type QuickInputService,
    QuickInputServiceDIToken,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { EditorServiceDIToken, type IEditorService } from "../../editor/common/editorService.ts";
import {
    type ConfiguredInput,
    type IConfigurationResolverService,
    VariableError,
} from "../common/configurationResolver.ts";
import { ConfigurationResolverExpression } from "../common/configurationResolverExpression.ts";
import { evaluateVariable, type IVariableResolveContext, resolveVariables } from "../common/variableResolver.ts";

/** Upstream's `configResolveInputLru`: the last values of the inputs, by `section.id`, most recent last. */
export const LAST_INPUTS: IStateDescriptor<readonly (readonly [string, string])[]> = {
    key: "configResolveInputLru",
    scope: "workspace",
    default: [],
};
const LAST_INPUTS_SIZE = 5;

export type ExtensionLookup = (id: string) => IExtension | undefined;

interface IPickStringItem extends QuickPickItem {
    readonly value: string;
}

export const ConfigurationResolverServiceDIToken = token<ConfigurationResolverService>("ConfigurationResolverService");

export class ConfigurationResolverService implements IConfigurationResolverService {
    public static dependencies = [
        IConfigurationServiceDIToken,
        IWorkspaceContextServiceDIToken,
        EditorServiceDIToken,
        CommandRegistryDIToken,
        QuickInputServiceDIToken,
        StateServiceDIToken,
    ] as const;

    /** Inputs are asked one at a time, even for resolutions running side by side. */
    private inputQueue: Promise<unknown> = Promise.resolve();
    private extensions: ExtensionLookup = () => undefined;

    public constructor(
        private readonly configuration: IConfigurationService,
        private readonly workspace: IWorkspaceContextService,
        private readonly editors: IEditorService,
        private readonly commands: CommandRegistry,
        private readonly quickInput: QuickInputService,
        private readonly state: IStateStore,
    ) {}

    /** The extension host is not part of every window; until it is, `${extensionInstallFolder:…}` finds nothing. */
    public setExtensions(lookup: ExtensionLookup): void {
        this.extensions = lookup;
    }

    public resolveAsync<T>(folder: IWorkspaceFolder | undefined, config: T): Promise<T> {
        return new Promise((resolve) => {
            resolve(this.resolveWithValues(folder, config));
        });
    }

    public resolveWithValues<T>(
        folder: IWorkspaceFolder | undefined,
        config: T,
        values?: ReadonlyMap<string, string>,
    ): T {
        return resolveVariables(config, () => this.context(folder), values);
    }

    public async resolveWithInteractionReplace<T>(
        folder: IWorkspaceFolder | undefined,
        config: T,
        section?: string,
        variables?: Readonly<Record<string, string>>,
        inputs?: () => Promise<readonly unknown[] | undefined>,
    ): Promise<T | undefined> {
        const values = await this.resolveWithInteraction(folder, config, section, variables, inputs);
        return values === undefined ? undefined : this.resolveWithValues(folder, config, values);
    }

    public async resolveWithInteraction(
        folder: IWorkspaceFolder | undefined,
        config: unknown,
        section?: string,
        variables?: Readonly<Record<string, string>>,
        inputs?: () => Promise<readonly unknown[] | undefined>,
    ): Promise<Map<string, string> | undefined> {
        const expression = ConfigurationResolverExpression.parse(config);
        let context: IVariableResolveContext | undefined;
        let configuredInputs: Promise<readonly unknown[] | undefined> | undefined;
        for (const variable of expression.unresolved()) {
            let value: string;
            if (variable.name === "command") {
                const id = variable.arg ?? "";
                const result = await this.executeCommand(variables?.[id] ?? id, expression.toObject());
                // Cancelling any input or command cancels the whole resolution.
                if (result === undefined || result === null) return undefined;
                if (typeof result !== "string") {
                    throw new VariableError(
                        `Cannot substitute command variable '${id}' because command did not return a result of type string.`,
                    );
                }
                value = result;
            } else if (variable.name === "input") {
                configuredInputs ??= inputs?.() ?? Promise.resolve(undefined);
                const input = await this.showUserInput(section, variable.arg ?? "", await configuredInputs, variables);
                if (input === undefined) return undefined;
                // A `command` input that returns nothing leaves the variable as is (upstream).
                if (input.value === undefined) continue;
                value = input.value;
            } else {
                value = evaluateVariable(variable, (context ??= this.context(folder)));
            }
            expression.resolve(variable, value);
        }
        return expression.resolvedValues();
    }

    private async executeCommand(id: string, argument: unknown): Promise<unknown> {
        // Upstream's `CommandService` message.
        if (!this.commands.has(id)) throw new Error(`command '${id}' not found`);
        return await this.commands.execute(id, argument);
    }

    private context(folder: IWorkspaceFolder | undefined): IVariableResolveContext {
        const editor = this.editors.getActiveTabEditor();
        const file = editor?.uri.scheme === "file" ? editor : undefined;
        const folders = this.workspace.getWorkspace().folders;
        const fileFolder = file === undefined ? null : this.workspace.getWorkspaceFolder(file.uri);
        return {
            folderPath: folder?.uri.fsPath,
            getFolderPath: (name) => folders.find((candidate) => candidate.name === name)?.uri.fsPath,
            workspaceFolderCount: folders.length,
            filePath: file?.uri.fsPath,
            fileFolderPath: fileFolder?.uri.fsPath,
            lineNumber: file === undefined ? undefined : file.primaryCursorLine + 1,
            columnNumber: file === undefined ? undefined : file.primaryCursorColumn + 1,
            getSelectedText: () => file?.getSelectedTexts()[0],
            env: process.env,
            userHome: process.env.HOME ?? process.env.USERPROFILE,
            cwd: process.cwd(),
            execPath: process.execPath,
            execInstallFolder: paths.dirname(process.execPath),
            getConfiguration: (key) => this.configuration.get(key),
            getExtensionLocation: (id) => this.extensions(id)?.location,
        };
    }

    /** `undefined` — cancelled; no `value` — a `command` input returned nothing. Inputs need a section (upstream). */
    private async showUserInput(
        section: string | undefined,
        id: string,
        inputs: readonly unknown[] | undefined,
        variables: Readonly<Record<string, string>> | undefined,
    ): Promise<{ readonly value?: string } | undefined> {
        if (section === undefined || inputs === undefined) {
            throw new VariableError(
                `Variable '${id}' must be defined in an 'inputs' section of the debug or task configuration.`,
            );
        }
        const info = inputs.findLast((input) => (input as Partial<ConfiguredInput> | null)?.id === id) as
            | ConfiguredInput
            | undefined;
        if (info === undefined) {
            throw new VariableError(
                `Undefined input variable '${id}' encountered. Remove or define '${id}' to continue.`,
            );
        }
        const missing = (attribute: string): VariableError =>
            new VariableError(`Input variable '${id}' is of type '${info.type}' and must include '${attribute}'.`);
        const lastValues = new Map(this.state.get(LAST_INPUTS));
        const key = `${section}.${id}`;
        const preset = (fallback: string | undefined): string | undefined =>
            variables?.[`input:${id}`] ?? lastValues.get(key) ?? fallback;
        const remember = (value: string): void => {
            lastValues.delete(key);
            lastValues.set(key, value);
            this.state.store(LAST_INPUTS, [...lastValues].slice(-LAST_INPUTS_SIZE));
        };
        switch (info.type) {
            case "promptString": {
                if (typeof info.description !== "string") throw missing("description");
                const value = await this.queueInput(() =>
                    this.quickInput.input({
                        prompt: info.description,
                        value: preset(info.default),
                        password: info.password === true,
                    }),
                );
                if (value !== undefined && info.password !== true) remember(value);
                return value === undefined ? undefined : { value };
            }
            case "pickString": {
                if (typeof info.description !== "string") throw missing("description");
                if (!Array.isArray(info.options)) throw missing("options");
                // The default (marked) and the preset value are moved to the top.
                const top = preset(info.default);
                const picks: IPickStringItem[] = [];
                const options: readonly unknown[] = info.options;
                for (const option of options) {
                    const entry =
                        typeof option === "string"
                            ? { value: option }
                            : (option as { readonly value?: unknown; readonly label?: unknown } | null);
                    if (typeof entry?.value !== "string") throw missing("value");
                    const { value, label } = entry;
                    const item: IPickStringItem = {
                        label: typeof label === "string" && label !== "" ? `${label}: ${value}` : value,
                        value,
                    };
                    if (value === info.default) picks.unshift({ ...item, description: "(Default)" });
                    else if (value === top) picks.unshift(item);
                    else picks.push(item);
                }
                const picked = (await this.queueInput(() =>
                    this.quickInput.quickPick({ placeholder: info.description, items: picks }),
                )) as IPickStringItem | undefined;
                if (picked !== undefined) remember(picked.value);
                return picked === undefined ? undefined : { value: picked.value };
            }
            case "command": {
                if (typeof info.command !== "string") throw missing("command");
                const result = await this.queueInput(() => this.executeCommand(info.command, info.args));
                if (result === undefined || result === null) return {};
                if (typeof result === "string") return { value: result };
                throw new VariableError(
                    `Cannot substitute input variable '${id}' because command '${info.command}' did not return a result of type string.`,
                );
            }
            default:
                throw new VariableError(
                    `Input variable '${id}' can only be of type 'promptString', 'pickString', or 'command'.`,
                );
        }
    }

    private queueInput<T>(show: () => Promise<T>): Promise<T> {
        const shown = this.inputQueue.then(show, show);
        this.inputQueue = shown.catch(() => undefined);
        return shown;
    }
}
