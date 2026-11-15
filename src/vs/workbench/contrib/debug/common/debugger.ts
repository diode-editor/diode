/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debugger.ts
// A debug type: its contribution and the way to an adapter. Not here yet, each with its task: merging the
// contributions of several extensions, the activation events and the extension descriptor (`vscode.debug`, #1139),
// interactive variables (`resolveWithInteractionReplace`, #1137), the configuration schema (IntelliSense in
// launch.json). The initial launch.json content is written with tabs and a `\n` end of line; the configuration
// manager turns the tabs into the editor's spaces. Not planned: the telemetry endpoint.

import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

import type {
    IAdapterManager,
    IConfig,
    IDebugAdapter,
    IDebugger,
    IDebuggerContribution,
    IDebuggerMetadata,
    IDebugService,
    IDebugSession,
} from "./debug.ts";

export class Debugger implements IDebugger, IDebuggerMetadata {
    public constructor(
        private readonly adapterManager: IAdapterManager,
        private readonly contribution: IDebuggerContribution,
        private readonly debugService: () => IDebugService,
        /** The context-key check of the debugger's `when`. */
        private readonly evaluateWhen: (when: string) => boolean,
    ) {}

    public async startDebugging(configuration: IConfig, parentSessionId: string): Promise<boolean> {
        const debugService = this.debugService();
        const parentSession = debugService.getModel().getSession(parentSessionId);
        return await debugService.startDebugging(undefined, configuration, { parentSession });
    }

    public createDebugAdapter(session: IDebugSession): Promise<IDebugAdapter> {
        const da = this.adapterManager.createDebugAdapter(session);
        if (da) {
            return Promise.resolve(da);
        }
        return Promise.reject(new Error(`Cannot find debug adapter for type '${this.type}'.`));
    }

    public substituteVariables(folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig> {
        return this.adapterManager.substituteVariables(this.type, folder, config);
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

    public get enabled(): boolean {
        return this.contribution.when === undefined || this.evaluateWhen(this.contribution.when);
    }

    public get strings(): IDebuggerMetadata["strings"] {
        // Upstream still reads the deprecated key of older extensions.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        return this.contribution.strings ?? this.contribution.uiMessages;
    }

    public interestedInLanguage(languageId: string): boolean {
        return !!this.contribution.languages?.includes(languageId);
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
