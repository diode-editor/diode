// Upstream `MainThreadTerminalShellIntegration` for one instance: what the shell integration of its emulator tells
// becomes the messages extensions read (`Terminal.shellIntegration`, the shell execution events).

import { DisposableMap, DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type {
    ITerminalCommand,
    ITerminalShellEnvironment,
} from "../../../../platform/terminal/common/capabilities/capabilities.ts";
import type { TerminalCapabilityChangeEvent } from "../../../../platform/terminal/common/capabilities/terminalCapabilityStore.ts";
import type { ShellIntegrationAddon } from "../../../../platform/terminal/common/xterm/shellIntegrationAddon.ts";
import type {
    IExtensionTerminalEvents,
    IExtensionTerminalShellIntegrationState,
} from "../../../api/common/iExtensionWindowSinks.ts";
import type { IWireTerminalCommandLine, IWireTerminalShellIntegrationEnv } from "../../../api/common/wireTypes.ts";

import type { ITerminalInstance } from "./terminalService.ts";

/** Upstream `Event.accumulate(instance.onData, 50)`: the output of a command goes out in batches. */
export const SHELL_EXECUTION_DATA_DEBOUNCE_MS = 50;

const ACTIVATION_EVENT_PREFIX = "onTerminalShellIntegration:";

type ShellIntegrationEvents = Pick<
    IExtensionTerminalEvents,
    | "shellIntegrationChanged"
    | "shellIntegrationCwd"
    | "shellIntegrationEnv"
    | "shellExecutionStart"
    | "shellExecutionData"
    | "shellExecutionEnd"
>;

export class TerminalShellIntegrationRelay implements IDisposable {
    private readonly store = new DisposableStore();
    /** One listener per capability: a relaunch replaces the capabilities, the listeners of the old ones go. */
    private readonly capabilityListeners = this.store.add(new DisposableMap<TerminalCapabilityChangeEvent["id"]>());
    private pendingData = "";
    private dataTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * @param events the subscribed subprocess, read on every event: there may be none.
     * @param activate upstream `_enableShellIntegration` activates `onTerminalShellIntegration:*` and `:<shell type>`.
     */
    public constructor(
        private readonly instance: ITerminalInstance,
        private readonly addon: ShellIntegrationAddon,
        private readonly events: () => ShellIntegrationEvents | null,
        private readonly activate: (event: string) => void,
    ) {
        const { capabilities } = addon;
        for (const id of ["commandDetection", "cwdDetection", "shellEnvDetection"] as const) {
            const capability = capabilities.get(id);
            if (capability !== undefined) this.watch({ id, capability } as TerminalCapabilityChangeEvent);
        }
        this.store.add(
            capabilities.onDidAddCapability((event) => {
                this.watch(event);
            }),
        );
    }

    /** For a new subprocess: `undefined` while shell integration has not come alive. */
    public state(): IExtensionTerminalShellIntegrationState | undefined {
        const { capabilities } = this.addon;
        if (!capabilities.has("commandDetection")) return undefined;
        const { id } = this.instance;
        const cwd = capabilities.get("cwdDetection");
        const env = capabilities.get("shellEnvDetection");
        return {
            integration: { id, supportsExecuteCommand: this.supportsExecuteCommand },
            ...(cwd !== undefined ? { cwd: { id, cwd: cwd.getCwd() } } : {}),
            ...(env !== undefined ? { env: { id, ...wireEnv(env.env) } } : {}),
        };
    }

    /** Upstream `instanceSupportsExecuteCommandApi`. */
    private get supportsExecuteCommand(): boolean {
        return !this.instance.isFeatureTerminal;
    }

    private watch(event: TerminalCapabilityChangeEvent): void {
        const { id } = this.instance;
        switch (event.id) {
            case "commandDetection": {
                const { capability } = event;
                const listeners = new DisposableStore();
                listeners.add(
                    capability.onCommandExecuted((command) => {
                        this.events()?.shellExecutionStart({
                            id,
                            supportsExecuteCommand: this.supportsExecuteCommand,
                            commandLine: wireCommandLine(command),
                            ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
                        });
                    }),
                );
                listeners.add(
                    capability.onCommandFinished((command) => {
                        // Upstream disposes the debounced listener, which flushes it: no data after the end.
                        this.flushData();
                        this.events()?.shellExecutionEnd({
                            id,
                            commandLine: wireCommandLine(command),
                            ...(command.exitCode !== undefined ? { exitCode: command.exitCode } : {}),
                        });
                    }),
                );
                listeners.add(
                    this.addon.onDidWriteCommandOutput(({ data }) => {
                        this.pendingData += data;
                        clearTimeout(this.dataTimer);
                        this.dataTimer = setTimeout(() => {
                            this.flushData();
                        }, SHELL_EXECUTION_DATA_DEBOUNCE_MS);
                    }),
                );
                this.capabilityListeners.set(event.id, listeners);
                this.enable();
                return;
            }
            case "cwdDetection":
                this.capabilityListeners.set(
                    event.id,
                    event.capability.onDidChangeCwd((cwd) => {
                        this.events()?.shellIntegrationCwd({ id, cwd });
                    }),
                );
                return;
            case "shellEnvDetection":
                this.capabilityListeners.set(
                    event.id,
                    event.capability.onDidChangeEnv((env) => {
                        this.events()?.shellIntegrationEnv({ id, ...wireEnv(env) });
                    }),
                );
                return;
        }
    }

    /** Upstream `_enableShellIntegration`. */
    private enable(): void {
        this.activate(`${ACTIVATION_EVENT_PREFIX}*`);
        const { shellType } = this.instance;
        if (shellType !== undefined) this.activate(`${ACTIVATION_EVENT_PREFIX}${shellType}`);
        const events = this.events();
        if (events === null) return;
        const { id } = this.instance;
        events.shellIntegrationChanged({ id, supportsExecuteCommand: this.supportsExecuteCommand });
        const cwd = this.addon.capabilities.get("cwdDetection");
        if (cwd !== undefined) events.shellIntegrationCwd({ id, cwd: cwd.getCwd() });
    }

    private flushData(): void {
        clearTimeout(this.dataTimer);
        if (this.pendingData === "") return;
        const data = this.pendingData;
        this.pendingData = "";
        this.events()?.shellExecutionData({ id: this.instance.id, data });
    }

    public dispose(): void {
        clearTimeout(this.dataTimer);
        this.store.dispose();
    }
}

/** Upstream `convertToExtHostCommandLineConfidence`. */
function wireCommandLine(command: ITerminalCommand): IWireTerminalCommandLine {
    const confidence =
        command.commandLineConfidence === "high" ? 2 : command.commandLineConfidence === "medium" ? 1 : 0;
    return { value: command.command, confidence, isTrusted: command.isTrusted };
}

function wireEnv(env: ITerminalShellEnvironment): Omit<IWireTerminalShellIntegrationEnv, "id"> {
    return { env: env.value, isTrusted: env.isTrusted };
}
