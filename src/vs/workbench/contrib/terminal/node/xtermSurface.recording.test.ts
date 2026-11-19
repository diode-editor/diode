import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { describe, expect, it, vi } from "vitest";

import { ExtensionPtySession } from "./extensionPtySession.ts";

// What `Developer: Record Terminal Session` listens to — on the real emulator, over an extension pty (no process).

function make() {
    const onInput = vi.fn<(data: string) => void>();
    const session = new ExtensionPtySession({ cols: 30, rows: 4, name: "pty", onInput, onResize: vi.fn() });
    const events: string[] = [];
    session.onWillData((data) => events.push(`output ${JSON.stringify(data)}`));
    session.onDidWriteData((data) => events.push(`input ${JSON.stringify(data)}`));
    session.onDidSendText((data) => events.push(`sendText ${JSON.stringify(data)}`));
    session.onDidChangeDimensions(() => events.push(`resize ${JSON.stringify(session.dimensions)}`));
    return { session, events, onInput };
}

function row(session: ExtensionPtySession, y: number): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    let text = "";
    for (let x = 0; x < 30; x++) if (session.readCell(x, y, out)) text += out.char;
    return text.trimEnd();
}

describe("XtermSurface — recording events", () => {
    it("process output is reported raw, escape sequences included, before it is parsed", async () => {
        const { session, events } = make();
        await session.xtermReady;
        session.feed("\u001b]633;A\u0007hi");
        expect(events).toStrictEqual([`output ${JSON.stringify("\u001b]633;A\u0007hi")}`]);
        expect(row(session, 0)).toBe("");
        await vi.waitFor(() => {
            expect(row(session, 0)).toBe("hi");
        });
        session.dispose();
    });

    it("our own text (printMessage) is parsed but is not process output", async () => {
        const { session, events } = make();
        session.printMessage("\u001b[31mred");
        await vi.waitFor(() => {
            expect(row(session, 0)).toBe("red");
        });
        expect(events).toStrictEqual([]);
        session.dispose();
    });

    it("write is input, sendText is sent text; both reach the process", () => {
        const { session, events, onInput } = make();
        session.write("ls");
        session.sendText("echo hi\r");
        expect(events).toStrictEqual(['input "ls"', `sendText ${JSON.stringify("echo hi\r")}`]);
        expect(onInput.mock.calls).toStrictEqual([["ls"], ["echo hi\r"]]);
        session.dispose();
    });

    it("emulator replies are input too (upstream xterm.onData)", async () => {
        const { session, events } = make();
        await session.xtermReady;
        // DSR cursor position report.
        session.feed("\u001b[6n");
        await vi.waitFor(() => {
            expect(events).toContain(`input ${JSON.stringify("\u001b[1;1R")}`);
        });
        session.dispose();
    });

    it("after exit nothing is reported: the input went nowhere", () => {
        const { session, events } = make();
        session.exit(0);
        session.write("a");
        session.sendText("b");
        session.feed("c");
        expect(events).toStrictEqual([]);
        session.dispose();
    });

    it("an actual resize reports the new dimensions; the same size does not", () => {
        const { session, events } = make();
        expect(session.dimensions).toStrictEqual({ cols: 30, rows: 4 });
        session.resize(30, 4);
        session.resize(40, 10);
        expect(events).toStrictEqual(['resize {"cols":40,"rows":10}']);
        session.dispose();
    });
});
