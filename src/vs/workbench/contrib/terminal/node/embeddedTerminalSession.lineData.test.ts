import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// `onLineData` of a real shell in a PTY — the lines task problem matchers read.

function collect(session: EmbeddedTerminalSession): { lines: string[]; exited: Promise<number> } {
    const lines: string[] = [];
    session.onLineData((line) => lines.push(line));
    const exited = new Promise<number>((resolve) => {
        const sub = session.onExit((code) => {
            sub.dispose();
            resolve(code);
        });
    });
    return { lines, exited };
}

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("EmbeddedTerminalSession — output lines", () => {
    // Upstream defers the line listener until `initialText` is written: "Executing task: <command line>" is not
    // output. Here the banner of `printf 'main.c(1,1): error C1: x\n'` matched $msCompile itself — a second
    // problem in Problems whose file is "*  Executing task: printf '…/main.c".
    it("the message (task banner) is not an output line", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 80,
            rows: 8,
            shell: "/bin/sh",
            args: ["-c", "echo out"],
            message: " *  Executing task: echo /ws/main.c(1,1): error C1: x",
        });
        const { lines, exited } = collect(session);
        await exited;
        expect(lines).toStrictEqual(["out"]);
        session.dispose();
    });

    it("the message of a relaunch (reused task terminal) is not an output line either", async () => {
        const session = new EmbeddedTerminalSession({ cols: 80, rows: 8, shell: "/bin/sh", args: ["-c", "true"] });
        const first = collect(session);
        await first.exited;
        const lines: string[] = [];
        session.onLineData((line) => lines.push(line));
        const exited = new Promise<void>((resolve) => {
            const sub = session.onExit(() => {
                sub.dispose();
                resolve();
            });
        });
        session.relaunch({
            shell: "/bin/sh",
            args: ["-c", "echo again"],
            message: " *  Executing task: echo /ws/main.c(1,1): error C1: x",
        });
        await exited;
        expect(lines).toStrictEqual(["again"]);
        session.dispose();
    });

    // `cat` of ~110 KB and more, exiting right away: the terminal stopped at line 2685 of 3000 ("main.c(3," and
    // then "Terminal will be reused by tasks"), so a lint of a big project lost the last problems. With `sleep 1`
    // before the exit all 3000 lines arrive. Same on main before #808; a process task (`cat big.txt`) too.
    it("a process that prints a lot and exits at once: every line is reported before the exit", async () => {
        const dir = mkdtempSync(join(tmpdir(), "diode-linedata-"));
        dirs.push(dir);
        const file = join(dir, "big.txt");
        const expected = Array.from(
            { length: 3000 },
            (_, i) => `main.c(${String((i % 4) + 1)},1): warning W${String(i)}: big-msg-${String(i)}`,
        );
        writeFileSync(file, `${expected.join("\n")}\n`);
        // The loss is a race with the exit: a few runs make it show every time.
        const counts: number[] = [];
        for (let run = 0; run < 5; run++) {
            const session = new EmbeddedTerminalSession({ cols: 120, rows: 10, shell: "/bin/cat", args: [file] });
            const { lines, exited } = collect(session);
            await exited;
            counts.push(lines.length);
            session.dispose();
        }
        expect(counts).toStrictEqual([3000, 3000, 3000, 3000, 3000]);
    }, 30_000);
});
