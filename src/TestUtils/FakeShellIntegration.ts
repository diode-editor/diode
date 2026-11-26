import { Emitter } from "../vs/base/common/event.ts";
import type {
    ITerminalCommand,
    ITerminalShellEnvironment,
} from "../vs/platform/terminal/common/capabilities/capabilities.ts";
import type { CommandDetectionCapability } from "../vs/platform/terminal/common/capabilities/commandDetectionCapability.ts";
import type { CwdDetectionCapability } from "../vs/platform/terminal/common/capabilities/cwdDetectionCapability.ts";
import type { ShellEnvDetectionCapability } from "../vs/platform/terminal/common/capabilities/shellEnvDetectionCapability.ts";
import { TerminalCapabilityStore } from "../vs/platform/terminal/common/capabilities/terminalCapabilityStore.ts";
import type {
    ITerminalCommandOutput,
    ShellIntegrationAddon,
} from "../vs/platform/terminal/common/xterm/shellIntegrationAddon.ts";

/** A finished or executing command as the command detection reports it. */
export function terminalCommand(command: string, extra: Partial<ITerminalCommand> = {}): ITerminalCommand {
    return {
        command,
        commandLineConfidence: "high",
        isTrusted: true,
        cwd: undefined,
        exitCode: undefined,
        ...extra,
    };
}

/**
 * The part of {@link ShellIntegrationAddon} the extension relay reads, driven by the test: capabilities come alive
 * when the test says so, and their events fire synchronously.
 */
export class FakeShellIntegration {
    public readonly capabilities = new TerminalCapabilityStore();
    private readonly output = new Emitter<ITerminalCommandOutput>();
    public readonly onDidWriteCommandOutput = this.output.event;
    public readonly executed = new Emitter<ITerminalCommand>();
    public readonly finished = new Emitter<ITerminalCommand>();
    public readonly cwdChanged = new Emitter<string>();
    public readonly envChanged = new Emitter<ITerminalShellEnvironment>();

    public get addon(): ShellIntegrationAddon {
        return this as unknown as ShellIntegrationAddon;
    }

    /** The first command sequence: the command detection capability. */
    public comeAlive(): void {
        this.capabilities.add("commandDetection", {
            onCommandExecuted: this.executed.event,
            onCommandFinished: this.finished.event,
        } as unknown as CommandDetectionCapability);
    }

    public addCwd(cwd: string): void {
        this.capabilities.add("cwdDetection", {
            getCwd: () => cwd,
            onDidChangeCwd: this.cwdChanged.event,
        } as unknown as CwdDetectionCapability);
    }

    public addEnv(env: ITerminalShellEnvironment): void {
        this.capabilities.add("shellEnvDetection", {
            env,
            onDidChangeEnv: this.envChanged.event,
        } as unknown as ShellEnvDetectionCapability);
    }

    public write(data: string): void {
        this.output.fire({ command: terminalCommand(""), data });
    }
}
