/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugAdapterManager.ts
// The seam extensions plug their debuggers into. Upstream reads the `debuggers` extension point itself; here
// `registerDebugger` takes a contribution, and `contributes.debuggers` (#1139) and the tests call it. Not here yet,
// each with its task: the descriptor factories, activation events and `guessDebugger` (`vscode.debug`, #1139–#1140),
// the launch.json schema and the task labels in it (#1138, #1157), `canSetBreakpointsIn` (gutter, #1148). A
// debugger's `when` is evaluated when asked: `debuggersAvailable` follows registrations, not the keys in `when`.
// `runInTerminal` goes to the core's terminal launcher, not to the adapter factory of the debug type (#1142).

import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type {
    IAdapterManager,
    IConfig,
    IDebugAdapter,
    IDebugAdapterFactory,
    IDebuggerContribution,
    IDebugService,
    IDebugSession,
    IDebugTerminalLauncher,
} from "../common/debug.ts";
import { Debugger } from "../common/debugger.ts";

export class AdapterManager extends Disposable implements IAdapterManager {
    private readonly debuggers: Debugger[] = [];
    private readonly debugAdapterFactories = new Map<string, IDebugAdapterFactory>();
    private readonly onDidRegisterDebuggerEmitter = this.register(new Emitter<void>());

    public constructor(
        private readonly debugService: () => IDebugService,
        private readonly contextKeys: Pick<ContextKeyService, "set" | "evaluate">,
        private readonly terminalLauncher: IDebugTerminalLauncher,
    ) {
        super();
        this.updateContextKeys();
    }

    public get onDidRegisterDebugger(): Event<void> {
        return this.onDidRegisterDebuggerEmitter.event;
    }

    public registerDebugger(contribution: IDebuggerContribution): IDisposable {
        const dbg = new Debugger(this, contribution, this.debugService, (when) => this.contextKeys.evaluate(when));
        this.debuggers.push(dbg);
        this.updateContextKeys();
        this.onDidRegisterDebuggerEmitter.fire();
        return {
            dispose: () => {
                const index = this.debuggers.indexOf(dbg);
                if (index >= 0) {
                    this.debuggers.splice(index, 1);
                    this.updateContextKeys();
                }
            },
        };
    }

    private updateContextKeys(): void {
        this.contextKeys.set("debuggersAvailable", this.hasEnabledDebuggers());
        this.contextKeys.set("debugExtensionAvailable", this.debuggers.length > 0);
    }

    public registerDebugAdapterFactory(debugTypes: string[], debugAdapterLauncher: IDebugAdapterFactory): IDisposable {
        debugTypes.forEach((debugType) => this.debugAdapterFactories.set(debugType, debugAdapterLauncher));
        return {
            dispose: () => {
                debugTypes.forEach((debugType) => this.debugAdapterFactories.delete(debugType));
            },
        };
    }

    public hasEnabledDebuggers(): boolean {
        return this.debuggers.some((dbg) => dbg.enabled);
    }

    public createDebugAdapter(session: IDebugSession): IDebugAdapter | undefined {
        return this.debugAdapterFactories.get(session.configuration.type)?.createDebugAdapter(session);
    }

    public substituteVariables(
        debugType: string,
        folder: IWorkspaceFolder | undefined,
        config: IConfig,
    ): Promise<IConfig> {
        const factory = this.debugAdapterFactories.get(debugType);
        return factory ? factory.substituteVariables(folder, config) : Promise.resolve(config);
    }

    public runInTerminal(
        args: DebugProtocol.RunInTerminalRequestArguments,
        sessionId: string,
    ): Promise<number | undefined> {
        const session = this.debugService().getModel().getSession(sessionId);
        if (!session) {
            return Promise.reject(new Error(`Unknown debug session '${sessionId}'.`));
        }
        return this.terminalLauncher.runInTerminal(args, session);
    }

    public getDebugger(type: string): Debugger | undefined {
        const lower = type.toLowerCase();
        return this.debuggers.find((dbg) => dbg.type.toLowerCase() === lower);
    }
}
