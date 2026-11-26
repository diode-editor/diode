/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debugger.ts
// A debug type: its contribution (merged by the adapter manager) and the way to an adapter. Variables are
// substituted as upstream's: by the adapter factory of the type, then by the configuration resolver with the
// debugger's `variables` (`${command:pickProcess}` → the extension's command). Before its adapter is created the
// extensions get `onDebugAdapterProtocolTracker:<type>`, so a tracker factory is registered in time. Not here yet:
// the configuration schema (IntelliSense in launch.json). The initial
// launch.json content is written with tabs and a `\n` end of line; the configuration manager turns the tabs into the
// editor's spaces. Not planned: the telemetry endpoint.

import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

import {
    DebugConfigurationProviderTriggerKind,
    type IAdapterManager,
    type IConfig,
    type IDebugAdapter,
    type IDebugger,
    type IDebuggerContribution,
    type IDebuggerMetadata,
    type IDebugService,
    type IDebugSession,
    type IDebugVariableResolver,
} from "./debug.ts";

export class Debugger implements IDebugger, IDebuggerMetadata {
    public constructor(
        private readonly adapterManager: IAdapterManager,
        private readonly contribution: IDebuggerContribution,
        private readonly debugService: () => IDebugService,
        /** The context-key check of the debugger's `when`. */
        private readonly evaluateWhen: (when: string) => boolean,
        private readonly resolveVariables: IDebugVariableResolver,
    ) {}

    public async startDebugging(configuration: IConfig, parentSessionId: string): Promise<boolean> {
        const debugService = this.debugService();
        const parentSession = debugService.getModel().getSession(parentSessionId);
        return await debugService.startDebugging(undefined, configuration, { parentSession });
    }

    public async createDebugAdapter(session: IDebugSession): Promise<IDebugAdapter> {
        await this.adapterManager.activateDebuggers("onDebugAdapterProtocolTracker", this.type);
        const da = this.adapterManager.createDebugAdapter(session);
        if (da) {
            return da;
        }
        throw new Error(`Cannot find debug adapter for type '${this.type}'.`);
    }

    /** `undefined` — the user cancelled an input or a command gave nothing. */
    public async substituteVariables(
        folder: IWorkspaceFolder | undefined,
        config: IConfig,
    ): Promise<IConfig | undefined> {
        const substitutedConfig = await this.adapterManager.substituteVariables(this.type, folder, config);
        return await this.resolveVariables(folder, substitutedConfig, this.variables);
    }

    public runInTerminal(
        args: DebugProtocol.RunInTerminalRequestArguments,
        sessionId: string,
    ): Promise<number | undefined> {
        return this.adapterManager.runInTerminal(args, sessionId);
    }

    public get label(): string {
        return this.contribution.label ?? this.contribution.type;
    }

    public get type(): string {
        return this.contribution.type;
    }

    /** The context-key condition of the contribution, as written. */
    public get when(): string | undefined {
        return this.contribution.when;
    }

    public get enabled(): boolean {
        return this.contribution.when === undefined || this.evaluateWhen(this.contribution.when);
    }

    /** Aliases of command ids for `${command:…}` (upstream `debuggers.variables`). */
    public get variables(): Readonly<Record<string, string>> | undefined {
        return this.contribution.variables;
    }

    public get strings(): IDebuggerMetadata["strings"] {
        // Upstream still reads the deprecated key of older extensions.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        return this.contribution.strings ?? this.contribution.uiMessages;
    }

    public get isHiddenFromDropdown(): boolean {
        return this.contribution.hiddenWhen !== undefined && this.evaluateWhen(this.contribution.hiddenWhen);
    }

    public interestedInLanguage(languageId: string): boolean {
        return !!this.contribution.languages?.includes(languageId);
    }

    public hasInitialConfiguration(): boolean {
        return !!this.contribution.initialConfigurations;
    }

    public hasDynamicConfigurationProviders(): boolean {
        return this.debugService()
            .getConfigurationManager()
            .hasDebugConfigurationProvider(this.type, DebugConfigurationProviderTriggerKind.Dynamic);
    }

    public hasConfigurationProvider(): boolean {
        return this.debugService().getConfigurationManager().hasDebugConfigurationProvider(this.type);
    }

    public getInitialConfigurationContent(initialConfigs?: IConfig[]): Promise<string> {
        // at this point we got some configs from the package.json and/or from registered DebugConfigurationProviders
        let initialConfigurations = this.contribution.initialConfigurations ?? [];
        if (initialConfigs) {
            initialConfigurations = initialConfigurations.concat(initialConfigs);
        }
        return Promise.resolve(initialConfigurationContent(initialConfigurations));
    }
}

/** Upstream's launch.json skeleton around the given configurations (`Debugger.getInitialConfigurationContent`). */
export function initialConfigurationContent(initialConfigurations: readonly unknown[]): string {
    const configs = JSON.stringify(initialConfigurations, null, "\t")
        .split("\n")
        .map((line) => "\t" + line)
        .join("\n")
        .trim();
    return [
        "{",
        "\t// Use IntelliSense to learn about possible attributes.",
        "\t// Hover to view descriptions of existing attributes.",
        "\t// For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387",
        '\t"version": "0.2.0",',
        `\t"configurations": ${configs}`,
        "}",
    ].join("\n");
}
