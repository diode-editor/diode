import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ITerminalCommand } from "../../../../platform/terminal/common/capabilities/capabilities.ts";

import { ExtensionPtySession } from "./extensionPtySession.ts";

// Shell integration over the shared surface, through an extension pty that writes the sequences itself (as upstream,
// such a pty gets integration too). The output stream is cut on C and D the way upstream `_onProcessData` does.

const vsc = (pt: string): string => `\x1b]633;${pt}\x07`;

const sessions: ExtensionPtySession[] = [];
afterEach(() => {
    for (const s of sessions.splice(0)) s.dispose();
});

function make() {
    const session = new ExtensionPtySession({ cols: 40, rows: 5, name: "pty", onInput: vi.fn(), onResize: vi.fn() });
    sessions.push(session);
    const output: string[] = [];
    const log: string[] = [];
    const finished: ITerminalCommand[] = [];
    session.shellIntegration.onDidWriteCommandOutput(({ command, data }) => {
        output.push(data);
        log.push(`data ${command.command}`);
    });
    session.shellIntegration.capabilities.onDidAddCommandDetectionCapability((detection) => {
        detection.onCommandExecuted((c) => log.push(`start ${c.command}`));
        detection.onCommandFinished((c) => {
            log.push(`end ${c.command}`);
            finished.push(c);
        });
    });
    return { session, output, log, finished };
}

function row(session: ExtensionPtySession, y: number): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    let text = "";
    for (let x = 0; x < 40; x++) if (session.readCell(x, y, out)) text += out.char;
    return text.trimEnd();
}

describe("XtermSurface — shell integration", () => {
    it("one chunk `A B E C <output> D;2`: the stream starts with C itself and stops before D; start → data → end", async () => {
        const { session, output, log, finished } = make();
        session.feed(`${vsc("A")}$ ${vsc("B")}${vsc("E;run")}${vsc("C")}\x1b[31mred\x1b[0m\r\n${vsc("D;2")}$ `);
        await vi.waitFor(() => {
            expect(finished).toHaveLength(1);
        });
        expect(output).toStrictEqual([vsc("C"), "\x1b[31mred\x1b[0m\r\n"]);
        expect(log).toStrictEqual(["start run", "data run", "data run", "end run"]);
        expect(finished[0].exitCode).toBe(2);
        expect([row(session, 0), row(session, 1), row(session, 2)]).toStrictEqual(["$ red", "$", ""]);
    });

    it("output in many chunks arrives piece by piece, unjoined; the prompt after D is not output", async () => {
        const { session, output, finished } = make();
        session.feed(`${vsc("B")}${vsc("C")}`);
        const chunk = "y".repeat(16 * 1024);
        for (let i = 0; i < 20; i++) session.feed(chunk);
        session.feed(`tail${vsc("D;0")}prompt`);
        await vi.waitFor(() => {
            expect(finished).toHaveLength(1);
        });
        expect(output).toHaveLength(22);
        expect(output.slice(1, 21).every((piece) => piece === chunk)).toBe(true);
        expect(output.at(-1)).toBe("tail");
    });

    it("onWillData reports the cut pieces, raw, before they are parsed", () => {
        const { session } = make();
        const raw: string[] = [];
        session.onWillData((d) => raw.push(d));
        session.feed(`a${vsc("C")}b${vsc("D")}`);
        expect(raw).toStrictEqual(["a", vsc("C"), "b", vsc("D")]);
    });

    it("C cut between two chunks: the chunk that completes it is output whole, as upstream", async () => {
        const { session, output, finished } = make();
        session.feed(`${vsc("B")}\x1b]63`);
        session.feed(`3;C\x07hi\r\n`);
        session.feed(`\x1b]633;D;0\x07`);
        await vi.waitFor(() => {
            expect(finished).toHaveLength(1);
        });
        expect(output).toStrictEqual(["3;C\x07hi\r\n"]);
    });

    it("an empty chunk still reaches the emulator (an update follows)", async () => {
        const { session } = make();
        await session.xtermReady;
        const updated = new Promise<void>((resolve) =>
            session.onUpdate(() => {
                resolve();
            }),
        );
        session.feed("");
        await updated;
    });

    it("no output outside a command", async () => {
        const { session, output } = make();
        session.feed(`plain${vsc("A")}${vsc("B")}`);
        await vi.waitFor(() => {
            expect(row(session, 0)).toBe("plain");
        });
        expect(output).toStrictEqual([]);
    });

    it("output written before the emulator loads still reaches the model in order", async () => {
        const { session, output, finished } = make();
        // The chunk is still loading right after construction: the pieces wait in the queue.
        session.feed(`${vsc("B")}${vsc("C")}x${vsc("D;0")}`);
        await session.xtermReady;
        await vi.waitFor(() => {
            expect(finished).toHaveLength(1);
        });
        expect(output).toStrictEqual([vsc("C"), "x"]);
    });

    it("relaunch: the model is reset, integration turns on again for the new process", async () => {
        const { session } = make();
        const on = vi.fn();
        session.shellIntegration.capabilities.onDidAddCommandDetectionCapability(on);
        session.feed(vsc("A"));
        await vi.waitFor(() => {
            expect(on).toHaveBeenCalledTimes(1);
        });
        session.exit(0);
        await vi.waitFor(() => {
            expect(session.isExited).toBe(true);
        });
        session.relaunch({});
        expect(session.shellIntegration.capabilities.has("commandDetection")).toBe(false);
        session.feed(vsc("A"));
        await vi.waitFor(() => {
            expect(on).toHaveBeenCalledTimes(2);
        });
    });

    it("dispose: the model goes with the session", async () => {
        const { session } = make();
        session.feed(vsc("A"));
        await vi.waitFor(() => {
            expect(session.shellIntegration.capabilities.has("commandDetection")).toBe(true);
        });
        session.dispose();
        expect(session.shellIntegration.capabilities.has("commandDetection")).toBe(false);
    });
});
