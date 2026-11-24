import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeShellIntegration, terminalCommand } from "../../../../../TestUtils/FakeShellIntegration.ts";
import type { IExtensionTerminalShellIntegrationEvents } from "../../../api/common/iExtensionWindowSinks.ts";

import type { ITerminalInstance } from "./terminalService.ts";
import { SHELL_EXECUTION_DATA_DEBOUNCE_MS, TerminalShellIntegrationRelay } from "./terminalShellIntegrationRelay.ts";

afterEach(() => {
    vi.useRealTimers();
});

function setup(instance: Partial<ITerminalInstance> = {}, before?: (shell: FakeShellIntegration) => void) {
    const shell = new FakeShellIntegration();
    before?.(shell);
    const sent: [string, unknown][] = [];
    const recorder: IExtensionTerminalShellIntegrationEvents = {
        shellIntegrationChanged: (e) => sent.push(["changed", e]),
        shellIntegrationCwd: (e) => sent.push(["cwd", e]),
        shellIntegrationEnv: (e) => sent.push(["env", e]),
        shellExecutionStart: (e) => sent.push(["start", e]),
        shellExecutionData: (e) => sent.push(["data", e]),
        shellExecutionEnd: (e) => sent.push(["end", e]),
    };
    let events: IExtensionTerminalShellIntegrationEvents | null = recorder;
    const activations: string[] = [];
    const relay = new TerminalShellIntegrationRelay(
        { id: 7, isFeatureTerminal: false, shellType: "bash", ...instance } as ITerminalInstance,
        shell.addon,
        () => events,
        (event) => activations.push(event),
    );
    const detach = (): void => {
        events = null;
    };
    const attach = (): void => {
        events = recorder;
    };
    return { shell, relay, sent, activations, detach, attach };
}

const ENV = { value: { A: "1" }, isTrusted: true };

describe("TerminalShellIntegrationRelay", () => {
    it("capabilities the emulator already has: activation and the whole state at once", () => {
        const h = setup({}, (shell) => {
            shell.addCwd("/w");
            shell.addEnv(ENV);
            shell.comeAlive();
        });
        expect(h.activations).toStrictEqual(["onTerminalShellIntegration:*", "onTerminalShellIntegration:bash"]);
        expect(h.sent).toStrictEqual([
            ["changed", { id: 7, supportsExecuteCommand: true }],
            ["cwd", { id: 7, cwd: "/w" }],
            ["env", { id: 7, env: { A: "1" }, isTrusted: true }],
        ]);
        h.relay.dispose();
    });

    it("state: none before the command detection; a task terminal does not support executeCommand", () => {
        const h = setup({ isFeatureTerminal: true });
        expect(h.relay.state()).toBeUndefined();
        h.shell.comeAlive();
        expect(h.relay.state()).toStrictEqual({ integration: { id: 7, supportsExecuteCommand: false } });
        h.shell.addCwd("/w");
        h.shell.addEnv(ENV);
        expect(h.relay.state()).toStrictEqual({
            integration: { id: 7, supportsExecuteCommand: false },
            cwd: { id: 7, cwd: "/w" },
            env: { id: 7, env: { A: "1" }, isTrusted: true },
        });
        h.relay.dispose();
    });

    it("coming alive without a subprocess activates and sends nothing", () => {
        const h = setup({ shellType: undefined });
        h.detach();
        h.shell.comeAlive();
        expect(h.activations).toStrictEqual(["onTerminalShellIntegration:*"]);
        expect(h.sent).toStrictEqual([]);
        h.relay.dispose();
    });

    it("start and end carry cwd and exit code only when the shell reported them; confidence as a number", () => {
        const h = setup();
        h.shell.comeAlive();
        h.sent.length = 0;
        h.shell.executed.fire(terminalCommand("ls", { commandLineConfidence: "medium", cwd: "/w" }));
        h.shell.finished.fire(terminalCommand("ls", { commandLineConfidence: "medium", cwd: "/w", exitCode: 0 }));
        h.shell.executed.fire(terminalCommand("x", { commandLineConfidence: "low", isTrusted: false }));
        h.shell.finished.fire(terminalCommand("x", { commandLineConfidence: "low", isTrusted: false }));
        const medium = { value: "ls", confidence: 1, isTrusted: true };
        const low = { value: "x", confidence: 0, isTrusted: false };
        expect(h.sent).toStrictEqual([
            ["start", { id: 7, supportsExecuteCommand: true, commandLine: medium, cwd: "/w" }],
            ["end", { id: 7, commandLine: medium, exitCode: 0 }],
            ["start", { id: 7, supportsExecuteCommand: true, commandLine: low }],
            ["end", { id: 7, commandLine: low }],
        ]);
        h.relay.dispose();
    });

    it("output goes out in one batch after the debounce; the end flushes it first; no output, no data", () => {
        vi.useFakeTimers();
        const h = setup();
        h.shell.comeAlive();
        h.sent.length = 0;
        h.shell.write("a");
        h.shell.write("b");
        vi.advanceTimersByTime(SHELL_EXECUTION_DATA_DEBOUNCE_MS - 1);
        expect(h.sent).toStrictEqual([]);
        vi.advanceTimersByTime(1);
        expect(h.sent).toStrictEqual([["data", { id: 7, data: "ab" }]]);
        h.shell.write("c");
        h.shell.finished.fire(terminalCommand("ls", { exitCode: 0 }));
        h.shell.finished.fire(terminalCommand("ls", { exitCode: 0 }));
        vi.runAllTimers();
        const line = { value: "ls", confidence: 2, isTrusted: true };
        expect(h.sent.slice(1)).toStrictEqual([
            ["data", { id: 7, data: "c" }],
            ["end", { id: 7, commandLine: line, exitCode: 0 }],
            ["end", { id: 7, commandLine: line, exitCode: 0 }],
        ]);
        h.relay.dispose();
    });

    it("without a subprocess nothing is sent or kept: output then is not sent to a later one", () => {
        vi.useFakeTimers();
        const h = setup();
        h.shell.comeAlive();
        h.sent.length = 0;
        h.shell.addCwd("/w");
        h.shell.addEnv(ENV);
        h.detach();
        h.shell.executed.fire(terminalCommand("ls"));
        h.shell.write("lost");
        h.shell.finished.fire(terminalCommand("ls"));
        h.shell.cwdChanged.fire("/x");
        h.shell.envChanged.fire(ENV);
        h.attach();
        h.shell.finished.fire(terminalCommand("ls"));
        vi.runAllTimers();
        expect(h.sent).toStrictEqual([
            ["end", { id: 7, commandLine: { value: "ls", confidence: 2, isTrusted: true } }],
        ]);
        h.relay.dispose();
    });

    it("output written while no subprocess is not sent to one that comes within the batch window", () => {
        vi.useFakeTimers();
        const h = setup();
        h.shell.comeAlive();
        h.sent.length = 0;
        h.detach();
        h.shell.write("before");
        h.attach();
        vi.runAllTimers();
        expect(h.sent).toStrictEqual([]);
        h.relay.dispose();
    });

    it("a subprocess gone before the batch goes out: the batch is dropped", () => {
        vi.useFakeTimers();
        const h = setup();
        h.shell.comeAlive();
        h.sent.length = 0;
        h.shell.write("a");
        h.detach();
        vi.runAllTimers();
        h.attach();
        h.shell.finished.fire(terminalCommand("ls"));
        expect(h.sent.map(([kind]) => kind)).toStrictEqual(["end"]);
        h.relay.dispose();
    });

    it("cwd and environment changes are relayed", () => {
        const h = setup();
        h.shell.addCwd("/w");
        h.shell.addEnv(ENV);
        h.shell.cwdChanged.fire("/x");
        h.shell.envChanged.fire({ value: { B: "2" }, isTrusted: false });
        expect(h.sent).toStrictEqual([
            ["cwd", { id: 7, cwd: "/x" }],
            ["env", { id: 7, env: { B: "2" }, isTrusted: false }],
        ]);
        h.relay.dispose();
    });

    it("disposed: no more events, a capability added later is not watched", () => {
        vi.useFakeTimers();
        const h = setup();
        h.shell.comeAlive();
        h.shell.addCwd("/w");
        h.sent.length = 0;
        h.shell.write("a");
        h.relay.dispose();
        vi.runAllTimers();
        h.shell.executed.fire(terminalCommand("ls"));
        h.shell.write("b");
        h.shell.finished.fire(terminalCommand("ls"));
        h.shell.cwdChanged.fire("/x");
        h.shell.addEnv(ENV);
        h.shell.envChanged.fire(ENV);
        vi.runAllTimers();
        expect(h.sent).toStrictEqual([]);
        expect(h.activations).toHaveLength(2);
    });
});
