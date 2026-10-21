import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { describe, expect, it, vi } from "vitest";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";
import { ExtensionPtySession } from "./extensionPtySession.ts";

function screen(session: EmbeddedTerminalSession | ExtensionPtySession, rows: number, width: number): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    const lines: string[] = [];
    for (let y = 0; y < rows; y++) {
        let text = "";
        for (let x = 0; x < width; x++) {
            if (session.readCell(x, y, out)) text += out.char;
        }
        lines.push(text.trimEnd());
    }
    return lines.join("\n").trimEnd();
}

function awaitExit(session: EmbeddedTerminalSession): Promise<number> {
    return new Promise<number>((resolve) => {
        const sub = session.onExit((code) => {
            sub.dispose();
            resolve(code);
        });
    });
}

const WAIT = { timeout: 5000, interval: 50 };

describe("EmbeddedTerminalSession.relaunch — a new process in the same emulator", () => {
    it("the previous output stays above, the new one starts on a new line after the message; new pid and shell", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 8,
            shell: "/bin/sh",
            args: ["-c", "printf first"],
        });
        const firstPid = session.pid;
        expect(await awaitExit(session)).toBe(0);
        const exited = awaitExit(session);
        session.relaunch({ shell: "/bin/bash", args: ["-c", "echo second; exit 4"], message: "run 2" });
        expect(session.isExited).toBe(false);
        expect(session.shell).toBe("/bin/bash");
        expect(session.pid).not.toBe(firstPid);
        expect(await exited).toBe(4);
        await vi.waitFor(() => {
            expect(screen(session, 8, 40)).toBe("first\nrun 2\nsecond");
        }, WAIT);
        session.dispose();
    });

    it("clear erases the previous output; without shell — the system shell; size is the emulator's", async () => {
        const session = new EmbeddedTerminalSession({ cols: 30, rows: 5, shell: "/bin/sh", args: ["-c", "echo old"] });
        await awaitExit(session);
        session.resize(33, 6);
        const exited = awaitExit(session);
        vi.stubEnv("SHELL", "/bin/sh");
        session.relaunch({
            args: ["-c", 'echo "$COLUMNS:$(tput cols 2>/dev/null || stty size | cut -d" " -f2)"'],
            clear: true,
        });
        vi.unstubAllEnvs();
        expect(session.shell).toBe("/bin/sh");
        await exited;
        await vi.waitFor(() => {
            expect(screen(session, 6, 33)).toMatch(/^\S*:33$/u);
        }, WAIT);
        session.dispose();
    });
});

describe("XtermSurface — editor messages and input after exit", () => {
    it("printMessage draws text as output and doesn't send it to the process", async () => {
        const onInput = vi.fn<(data: string) => void>();
        const session = new ExtensionPtySession({ cols: 20, rows: 3, name: "t", onInput, onResize: () => undefined });
        session.printMessage("hello\r\n");
        await vi.waitFor(() => {
            expect(screen(session, 3, 20)).toBe("hello");
        });
        expect(onInput).not.toHaveBeenCalled();
        session.dispose();
    });

    it("input after exit fires onDidInputAfterExit, not the process; before exit the opposite", () => {
        const onInput = vi.fn<(data: string) => void>();
        const session = new ExtensionPtySession({ cols: 20, rows: 3, name: "t", onInput, onResize: () => undefined });
        const afterExit = vi.fn();
        session.onDidInputAfterExit(afterExit);
        session.write("a");
        expect(afterExit).not.toHaveBeenCalled();
        session.exit(0);
        session.write("b");
        expect(afterExit).toHaveBeenCalledTimes(1);
        expect(onInput.mock.calls).toStrictEqual([["a"]]);
        session.dispose();
    });

    it("an extension pty after relaunch accepts output and input again and can exit once more", async () => {
        const onInput = vi.fn<(data: string) => void>();
        const session = new ExtensionPtySession({ cols: 20, rows: 4, name: "t", onInput, onResize: () => undefined });
        const exits = vi.fn();
        session.onExit(exits);
        session.feed("one");
        session.exit(1);
        session.relaunch({ message: "again" });
        session.feed("two");
        session.write("k");
        session.exit(2);
        expect(exits.mock.calls).toStrictEqual([[1], [2]]);
        expect(onInput.mock.calls).toStrictEqual([["k"]]);
        await vi.waitFor(() => {
            expect(screen(session, 4, 20)).toBe("one\nagain\ntwo");
        });
        session.dispose();
    });
});
