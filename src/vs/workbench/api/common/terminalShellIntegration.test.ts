import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { settle } from "../../../../TestUtils/timing.ts";

import { HIGH, LOW, setupShellIntegrations as setup } from "./terminalShellIntegration.testUtils.ts";

/** A macrotask: the end event waits for the `read()` streams. */
const macrotask = (): Promise<void> => settle(0);

/** Whether the promise is already settled once pending microtasks have run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
    let done = false;
    void promise.then(() => (done = true));
    await macrotask();
    return done;
}

describe("ext host shell integration", () => {
    it("changed: the first creates Terminal.shellIntegration, every one fires; an unknown terminal is ignored", () => {
        const h = setup();
        h.send("terminal.shellIntegration.changed", { id: 1, supportsExecuteCommand: true });
        const first = h.integration(1);
        h.send("terminal.shellIntegration.changed", { id: 1, supportsExecuteCommand: true });
        h.send("terminal.shellIntegration.changed", { id: 9, supportsExecuteCommand: true });
        expect(h.integration(1)).toBe(first);
        expect(h.log).toStrictEqual(["changed t1 cwd=-", "changed t1 cwd=-"]);
    });

    it("cwd: fires only on a change; an empty cwd is unknown", () => {
        const h = setup();
        h.send("terminal.shellIntegration.changed", { id: 1, supportsExecuteCommand: true });
        h.send("terminal.shellIntegration.cwd", { id: 1, cwd: "" });
        h.send("terminal.shellIntegration.cwd", { id: 1, cwd: "/a" });
        h.send("terminal.shellIntegration.cwd", { id: 1, cwd: "/a" });
        h.send("terminal.shellIntegration.cwd", { id: 1, cwd: "" });
        expect(h.log).toStrictEqual(["changed t1 cwd=-", "changed t1 cwd=/a", "changed t1 cwd=-"]);
        expect(h.integration(1).cwd).toBeUndefined();
    });

    it("env: every report fires; the value is a frozen copy", () => {
        const h = setup();
        h.send("terminal.shellIntegration.changed", { id: 1, supportsExecuteCommand: true });
        const env = (): { value: Record<string, string>; isTrusted: boolean } | undefined =>
            (h.integration(1) as unknown as { env?: { value: Record<string, string>; isTrusted: boolean } }).env;
        expect(env()).toBeUndefined();
        h.send("terminal.shellIntegration.env", { id: 1, env: { A: "1" }, isTrusted: true });
        h.send("terminal.shellIntegration.env", { id: 1, env: { A: "1" }, isTrusted: true });
        expect(h.log).toHaveLength(3);
        expect(env()).toStrictEqual({ isTrusted: true, value: { A: "1" } });
        expect(Object.isFrozen(env()?.value)).toBe(true);
    });

    it("broken envelopes and messages for a terminal without an integration change nothing", () => {
        const h = setup();
        for (const method of [
            "terminal.shellIntegration.changed",
            "terminal.shellIntegration.cwd",
            "terminal.shellIntegration.env",
            "terminal.shellExecution.start",
            "terminal.shellExecution.data",
            "terminal.shellExecution.end",
        ]) {
            h.send(method, null);
        }
        h.send("terminal.shellIntegration.cwd", { id: 2, cwd: "/a" });
        h.send("terminal.shellIntegration.env", { id: 2, env: {}, isTrusted: true });
        h.send("terminal.shellExecution.data", { id: 2, data: "x" });
        h.end(2, "ls", 0);
        h.start(9, "ls");
        expect(h.log).toStrictEqual([]);
    });

    it("a start without the change before it creates the integration", () => {
        const h = setup();
        h.start(1, "ls");
        expect(h.log).toStrictEqual(["changed t1 cwd=-", "start t1 ls"]);
        expect(h.integration(1)).toBeDefined();
    });

    it("executeCommand: a high-confidence start takes its exact line, a lower one the oldest, no match — a new one", () => {
        const h = setup();
        h.send("terminal.shellIntegration.changed", { id: 1, supportsExecuteCommand: true });
        const a = h.integration(1).executeCommand("a");
        const b = h.integration(1).executeCommand("b");
        const c = h.integration(1).executeCommand("c", ["x y", "'q r'"]);
        expect(h.requested).toStrictEqual(
            ["a", "b", `c "x y" 'q r'`].map((commandLine) => ({
                method: "terminal.shellIntegration.executeCommand",
                params: { id: 1, commandLine },
            })),
        );
        h.start(1, "b");
        h.start(1, "whatever", LOW);
        h.start(1, "d");
        expect(h.starts[0]).toBe(b);
        expect(h.starts[1]).toBe(a);
        expect(h.starts[2]).not.toBe(c);
        expect(h.starts[2].commandLine).toStrictEqual({ value: "d", ...HIGH });
    });

    it("executeCommand throws where the terminal does not support it", () => {
        const h = setup();
        h.send("terminal.shellIntegration.changed", { id: 1, supportsExecuteCommand: false });
        expect(() => h.integration(1).executeCommand("ls")).toThrow(
            "This terminal does not support the executeCommand API.",
        );
    });

    it("end: after a macrotask, with the line the shell reported at the end; no execution — no end", async () => {
        const h = setup();
        h.send("terminal.shellIntegration.changed", { id: 1, supportsExecuteCommand: true });
        h.end(1, "nothing", 0);
        h.send("terminal.shellExecution.data", { id: 1, data: "before any start" });
        h.start(1, "l", LOW);
        h.end(1, "ls -la", 3);
        expect(h.log).toStrictEqual(["changed t1 cwd=-", "start t1 l"]);
        await macrotask();
        expect(h.log.at(-1)).toBe("end t1 ls -la exit=3");
        expect(h.starts[0].commandLine.value).toBe("ls -la");
    });

    it("read(): data waits for its reader and reaches it before the end; a read after the end is empty", async () => {
        const h = setup();
        h.start(1, "ls");
        const early = h.starts[0].read()[Symbol.asyncIterator]();
        const first = early.next();
        expect(await settled(first)).toBe(false);
        h.send("terminal.shellExecution.data", { id: 1, data: "a" });
        expect(await settled(first)).toBe(true);
        await expect(first).resolves.toStrictEqual({ done: false, value: "a" });

        const late = h.starts[0].read()[Symbol.asyncIterator]();
        h.send("terminal.shellExecution.data", { id: 1, data: "b" });
        h.send("terminal.shellExecution.data", { id: 1, data: "c" });
        const b = late.next();
        expect(await settled(b)).toBe(true);
        await expect(b).resolves.toStrictEqual({ done: false, value: "b" });

        h.end(1, "ls", 0);
        await expect(late.next()).resolves.toStrictEqual({ done: false, value: "c" });
        await expect(late.next()).resolves.toStrictEqual({ done: true, value: undefined });
        await expect(h.starts[0].read()[Symbol.asyncIterator]().next()).resolves.toStrictEqual({
            done: true,
            value: undefined,
        });
    });

    it("close: the running execution ends without a code; the id gets a new integration afterwards", () => {
        const h = setup();
        h.start(1, "sleep");
        const before = h.integration(1);
        h.integrations.close(1);
        h.integrations.close(2);
        expect(h.log.at(-1)).toBe("end t1 sleep exit=undefined");
        h.send("terminal.shellIntegration.changed", { id: 1, supportsExecuteCommand: true });
        expect(h.integration(1)).not.toBe(before);
    });
});
