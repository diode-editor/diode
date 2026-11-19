import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { ExtensionPtySession } from "../node/extensionPtySession.ts";

import { RUN_COMMAND_INTERRUPT_DELAY_MS, TerminalService } from "./terminalService.ts";

// `runCommand` (an extension's `executeCommand`) on a real emulator: what the test feeds is what a shell with the
// integration script would have written, what the shell gets is recorded.

const osc = (body: string): string => `\x1b]633;${body}\x07`;

/** The emulator parses asynchronously. */
async function drain(): Promise<void> {
    for (let i = 0; i < 10; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

const disposables: { dispose(): void }[] = [];
afterEach(() => {
    vi.useRealTimers();
    for (const d of disposables.splice(0)) d.dispose();
});

function setup(settings: Record<string, unknown> = {}) {
    const views = makeViewsHarness();
    const input: string[] = [];
    const shells: ExtensionPtySession[] = [];
    const service = new TerminalService(views.service, createTestConfigurationService(settings), (o) => {
        const shell = new ExtensionPtySession({
            cols: o.cols,
            rows: o.rows,
            name: "bash",
            onInput: (data) => input.push(data),
            onResize: () => undefined,
        });
        shells.push(shell);
        return shell;
    });
    disposables.push(service);
    const { id } = service.createInstance({ name: "bash" });
    const feed = async (data: string): Promise<void> => {
        shells[0].feed(data);
        await drain();
    };
    return { service, id, input, feed };
}

describe("TerminalService.runCommand — an extension's executeCommand", () => {
    it("an empty prompt taking input: the line with Enter at once", async () => {
        const h = setup();
        await h.feed(`${osc("A")}$ ${osc("B")}`);
        await h.service.runCommand(h.id, "echo hi");
        expect(h.input).toStrictEqual(["echo hi\r"]);
    });

    it("text on the prompt: Ctrl+C first, the line after a pause", async () => {
        const h = setup();
        await h.feed(`${osc("A")}$ ${osc("B")}abc`);
        const done = h.service.runCommand(h.id, "echo ok");
        await drain();
        expect(h.input).toStrictEqual(["\x03"]);
        await done;
        expect(h.input).toStrictEqual(["\x03", "echo ok\r"]);
    });

    it("before the integration comes alive: waits for the prompt to take input", async () => {
        const h = setup({ "terminal.integrated.shellIntegration.timeout": 60_000 });
        const done = h.service.runCommand(h.id, "echo hi");
        await h.feed("loading rc files\r\n");
        await h.feed(`${osc("A")}$ `);
        expect(h.input).toStrictEqual([]);
        await h.feed(osc("B"));
        await done;
        expect(h.input).toStrictEqual(["echo hi\r"]);
    });

    it("the integration alive, the prompt not taking input yet: waits for its B", async () => {
        const h = setup({ "terminal.integrated.shellIntegration.timeout": 60_000 });
        await h.feed(`${osc("A")}$ ${osc("B")}make${osc("E;make")}\r\n${osc("C")}`);
        const done = h.service.runCommand(h.id, "echo hi");
        await h.feed(`building\r\n${osc("D;0")}${osc("A")}$ `);
        expect(h.input).toStrictEqual([]);
        await h.feed(osc("B"));
        await done;
        expect(h.input).toStrictEqual(["echo hi\r"]);
    });

    it("no integration by the timeout: Ctrl+C and the line anyway", async () => {
        vi.useFakeTimers();
        const h = setup({ "terminal.integrated.shellIntegration.enabled": false });
        void h.service.runCommand(h.id, "echo hi");
        await vi.advanceTimersByTimeAsync(1999);
        expect(h.input).toStrictEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.input).toStrictEqual(["\x03"]);
        await vi.advanceTimersByTimeAsync(RUN_COMMAND_INTERRUPT_DELAY_MS - 1);
        expect(h.input).toStrictEqual(["\x03"]);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.input).toStrictEqual(["\x03", "echo hi\r"]);
    });

    it("the timeout counts from the process start: the setting, less the time already gone", async () => {
        vi.useFakeTimers();
        const h = setup({ "terminal.integrated.shellIntegration.timeout": 800 });
        await vi.advanceTimersByTimeAsync(300);
        void h.service.runCommand(h.id, "echo hi");
        await vi.advanceTimersByTimeAsync(499);
        expect(h.input).toStrictEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.input).toStrictEqual(["\x03"]);
    });

    it("the injection on, the default: 5000 ms", async () => {
        vi.useFakeTimers();
        const h = setup();
        void h.service.runCommand(h.id, "echo hi");
        await vi.advanceTimersByTimeAsync(4999);
        expect(h.input).toStrictEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.input).toStrictEqual(["\x03"]);
    });

    it("a closed terminal: nothing", async () => {
        const h = setup();
        h.service.closeInstance(h.id, "extension");
        await h.service.runCommand(h.id, "echo hi");
        expect(h.input).toStrictEqual([]);
    });
});
