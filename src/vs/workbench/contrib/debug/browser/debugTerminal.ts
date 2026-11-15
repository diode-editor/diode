/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/api/node/extHostDebugService.ts
// `$runInTerminal` and `DebugTerminalCollection`. Upstream answers the request in the extension host through the
// `vscode.window` terminals; the terminal is the core's here, so the core answers it directly through
// `TerminalService` — the adapter sees the same. Deviations: `kind: external` runs in the integrated terminal too
// (a TUI has no external terminal to open) after a line in the Debug Console; a request without `kind` is
// `integrated`, the protocol's default (upstream runs nothing); the shell is the default one, not the automation
// profile (`terminal.integrated.automationProfile.*` is not supported), and the terminal has no debug icon
// (terminals have no icons). There is no shell integration: the readiness of a new shell is the 500 ms of quiet, a
// reused one always takes the Ctrl+C and the `clear` path. Checking the free terminals runs one after another, not
// in parallel.

import { disposableTimeout, RunOnceScheduler, timeout } from "../../../../base/common/async.ts";
import { Disposable, DisposableStore } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import {
    type ITerminalInstance,
    TERMINAL_VIEW_ID,
    type TerminalService,
    TerminalServiceDIToken,
} from "../../terminal/browser/terminalService.ts";
import { type DefaultShellResolver, DefaultShellResolverDIToken } from "../../terminal/common/defaultShell.ts";
import type { IDebugSession, IDebugTerminalLauncher } from "../common/debug.ts";
import { prepareCommand, shellTypeOf } from "../common/terminals.ts";

/** `node/terminals.ts`: whether the shell runs a program, i.e. the terminal is busy. */
export type HasChildProcesses = (processId: number | undefined) => Promise<boolean>;
export const HasChildProcessesDIToken = token<HasChildProcesses>("HasChildProcesses");

export const DebugTerminalLauncherDIToken = token<IDebugTerminalLauncher>("DebugTerminalLauncher");

/** Ours: the Debug Console line of `kind: external`. */
export const EXTERNAL_TERMINAL_UNAVAILABLE = "external terminal is not available, using the integrated one";

const DEBUG_PROCESS_TITLE = "Debug Process";

const Timing = {
    /** A new shell is ready once its output has been quiet this long… */
    DataDebounce: 500,
    /** …or after this long anyway. */
    MaxDelay: 5000,
    /** Ctrl+C and `clear` in a reused terminal get this long to be processed. */
    CommandDelay: 200,
    /** Delay before a new terminal is a candidate for reuse. See #71850 */
    MinUseDelay: 1000,
} as const;

interface ITerminalInfo {
    /** `-1`: free — its session has ended. */
    lastUsedAt: number;
    readonly config: string;
}

class DebugTerminalCollection {
    private readonly terminalInstances = new Map<ITerminalInstance, ITerminalInfo>();

    public constructor(private readonly hasChildProcesses: HasChildProcesses) {}

    public async checkout(config: string, name: string): Promise<ITerminalInstance | undefined> {
        for (const [terminal, termInfo] of [...this.terminalInstances]) {
            // Only allow terminals that match the title.  See #123189
            if (terminal.title !== name) {
                continue;
            }

            if (termInfo.lastUsedAt !== -1 && (await this.hasChildProcesses(terminal.processId))) {
                continue;
            }

            // important: date check and map operations must be synchronous
            const now = Date.now();
            if (termInfo.lastUsedAt + Timing.MinUseDelay > now || termInfo.config !== config) {
                continue;
            }

            termInfo.lastUsedAt = now;
            return terminal;
        }
        return undefined;
    }

    public insert(terminal: ITerminalInstance, termConfig: string): void {
        this.terminalInstances.set(terminal, { lastUsedAt: Date.now(), config: termConfig });
    }

    public free(terminal: ITerminalInstance): void {
        const info = this.terminalInstances.get(terminal);
        if (info) {
            info.lastUsedAt = -1;
        }
    }

    public onTerminalClosed(terminal: ITerminalInstance): void {
        this.terminalInstances.delete(terminal);
    }
}

export class DebugTerminalLauncher extends Disposable implements IDebugTerminalLauncher {
    public static dependencies = [
        TerminalServiceDIToken,
        ViewsServiceDIToken,
        DefaultShellResolverDIToken,
        IConfigurationServiceDIToken,
        HasChildProcessesDIToken,
    ] as const;

    private readonly integratedTerminalInstances: DebugTerminalCollection;

    public constructor(
        private readonly terminals: Pick<
            TerminalService,
            "createInstance" | "showInstance" | "sendText" | "onDidDisposeInstance"
        >,
        private readonly views: Pick<ViewsService, "openView">,
        private readonly defaultShell: DefaultShellResolver,
        private readonly configuration: Pick<IConfigurationService, "get">,
        hasChildProcesses: HasChildProcesses,
    ) {
        super();
        this.integratedTerminalInstances = new DebugTerminalCollection(hasChildProcesses);
        // React on terminal disposed and check if that is the debug terminal #12956
        this.register(
            terminals.onDidDisposeInstance((terminal) => {
                this.integratedTerminalInstances.onTerminalClosed(terminal);
            }),
        );
    }

    public async runInTerminal(
        args: DebugProtocol.RunInTerminalRequestArguments,
        session: IDebugSession,
    ): Promise<number | undefined> {
        if (args.kind === "external") {
            session.appendToRepl({ output: `${EXTERNAL_TERMINAL_UNAVAILABLE}\n`, sev: "warning" });
        }

        const shell = this.defaultShell();
        const terminalName = args.title !== undefined && args.title !== "" ? args.title : DEBUG_PROCESS_TITLE;
        const shellConfig = JSON.stringify({ shell, cwd: args.cwd });
        let terminal = await this.integratedTerminalInstances.checkout(shellConfig, terminalName);

        let cwdForPrepareCommand: string | undefined;
        let giveShellTimeToInitialize = false;

        if (!terminal) {
            terminal = this.terminals.createInstance({ shellPath: shell, cwd: args.cwd, name: terminalName });
            giveShellTimeToInitialize = true;
            this.integratedTerminalInstances.insert(terminal, shellConfig);
        } else {
            cwdForPrepareCommand = args.cwd;
        }

        // `terminal.show(true)`: revealed, the focus stays where it is.
        this.terminals.showInstance(terminal.id);
        this.views.openView(TERMINAL_VIEW_ID, false, false);

        const shellProcessId = terminal.processId;

        if (giveShellTimeToInitialize) {
            // give a new terminal some time to initialize the shell (most recently, #228191):
            // debounce content being written to know when the prompt is available
            await this.whenQuiet(terminal);
        } else {
            if (terminal.isInteractedWith) {
                this.terminals.sendText(terminal.id, "\u0003", false); // Ctrl+C for #106743. Not part of the same command for #107969
                await timeout(Timing.CommandDelay);
            }

            if (this.configuration.get("debug.terminal.clearBeforeReusing")) {
                // clear terminal before reusing it
                this.terminals.sendText(terminal.id, clearCommandOf(shell), true);
                await timeout(Timing.CommandDelay); // add a small delay to ensure the command is processed, see #240953
            }
        }

        const command = prepareCommand(
            shell,
            args.args,
            args.argsCanBeInterpretedByShell === true,
            cwdForPrepareCommand,
            args.env,
        );
        this.terminals.sendText(terminal.id, command, true);

        // Mark terminal as unused when its session ends, see #112055
        const used = terminal;
        const sessionListener = session.onDidEndAdapter(() => {
            this.integratedTerminalInstances.free(used);
            sessionListener.dispose();
        });

        return shellProcessId;
    }

    private whenQuiet(terminal: ITerminalInstance): Promise<void> {
        const ds = new DisposableStore();
        return new Promise<void>((resolve) => {
            const scheduler = ds.add(new RunOnceScheduler(resolve, Timing.DataDebounce));
            ds.add(
                terminal.session.onUpdate(() => {
                    scheduler.schedule();
                }),
            );
            ds.add(disposableTimeout(resolve, Timing.MaxDelay));
        }).finally(() => {
            ds.dispose();
        });
    }
}

function clearCommandOf(shell: string): string {
    return shellTypeOf(shell) === "bash" ? "clear" : "cls";
}
