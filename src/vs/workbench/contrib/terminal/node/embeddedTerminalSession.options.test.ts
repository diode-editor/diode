import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { describe, expect, it, vi } from "vitest";

import { buildEnv, EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// The environment is tested both as a pure function and with a real shell: what reached the process shows
// only in its output.

function screen(session: EmbeddedTerminalSession, rows: number, width: number): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    const lines: string[] = [];
    for (let y = 0; y < rows; y++) {
        let text = "";
        for (let x = 0; x < width; x++) {
            if (session.readCell(x, y, out)) text += out.char;
        }
        lines.push(text.trimEnd());
    }
    return lines.join("\n");
}

function awaitExit(session: EmbeddedTerminalSession): Promise<number> {
    return new Promise<number>((resolve) => {
        session.onExit(resolve);
    });
}

describe("buildEnv", () => {
    it("over the base: strings set, null unsets; TERM is ours, TMUX is always unset", () => {
        expect(
            buildEnv(
                { KEEP: "1", DROP: "2", TERM: "dumb", TMUX: "/tmp/tmux" },
                { ADD: "3", DROP: null, TMUX: "again" },
            ),
        ).toEqual({ KEEP: "1", ADD: "3", TERM: "xterm-256color" });
        expect(buildEnv({ A: "1" }, undefined)).toEqual({ A: "1", TERM: "xterm-256color" });
    });
});

describe("EmbeddedTerminalSession — extension terminal options", () => {
    it("env reaches the shell, null unsets an inherited variable, pid is the shell process's", async () => {
        vi.stubEnv("DIODE_TERM_INHERITED", "inherited");
        vi.stubEnv("DIODE_TERM_DROPPED", "dropped");
        const session = new EmbeddedTerminalSession({
            cols: 60,
            rows: 6,
            shell: "/bin/sh",
            args: ["-c", 'echo "[$DIODE_TERM_INHERITED|$DIODE_TERM_DROPPED|$DIODE_TERM_ADDED|$$]"'],
            env: { DIODE_TERM_ADDED: "added", DIODE_TERM_DROPPED: null },
        });
        vi.unstubAllEnvs();
        const pid = session.pid;
        expect(pid).toBeGreaterThan(0);
        await awaitExit(session);
        await vi.waitFor(
            () => {
                expect(screen(session, 6, 60)).toContain(`[inherited||added|${String(pid)}]`);
            },
            { timeout: 5000, interval: 50 },
        );
        session.dispose();
    }, 15000);

    it("strictEnv: nothing inherited, only the terminal env", async () => {
        vi.stubEnv("DIODE_TERM_INHERITED", "inherited");
        const session = new EmbeddedTerminalSession({
            cols: 60,
            rows: 6,
            shell: "/bin/sh",
            args: ["-c", 'echo "[$DIODE_TERM_INHERITED|$ONLY]"'],
            env: { ONLY: "mine", PATH: "/usr/bin:/bin" },
            strictEnv: true,
        });
        vi.unstubAllEnvs();
        await awaitExit(session);
        await vi.waitFor(
            () => {
                // Without `message` the shell output comes first.
                expect(screen(session, 6, 60).split("\n")[0]).toBe("[|mine]");
            },
            { timeout: 5000, interval: 50 },
        );
        session.dispose();
    }, 15000);

    it("message triggers a redraw by itself — even while the shell is silent", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 4,
            shell: "/bin/sh",
            args: ["-c", "read line"],
            message: "waiting",
        });
        const updates = vi.fn();
        session.onUpdate(updates);
        await vi.waitFor(() => {
            expect(updates).toHaveBeenCalled();
        });
        expect(screen(session, 4, 40).split("\n")[0]).toBe("waiting");
        session.dispose();
    }, 15000);

    it("message is printed as the first line, before shell output, and isn't sent to the shell", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 60,
            rows: 6,
            shell: "/bin/sh",
            args: ["-c", "echo from-shell"],
            message: "Hello from extension",
        });
        const updates = vi.fn();
        session.onUpdate(updates);
        await awaitExit(session);
        await vi.waitFor(
            () => {
                const [first, second] = screen(session, 6, 60).split("\n");
                expect(first).toBe("Hello from extension");
                expect(second).toBe("from-shell");
            },
            { timeout: 5000, interval: 50 },
        );
        expect(updates).toHaveBeenCalled();
        session.dispose();
    }, 15000);

    it("dispose of a live session kills the shell process", async () => {
        const session = new EmbeddedTerminalSession({ cols: 20, rows: 4, shell: "/bin/sh", args: ["-c", "sleep 30"] });
        const { pid } = session;
        const exited = awaitExit(session);
        session.dispose();
        await exited;
        expect(() => process.kill(pid, 0)).toThrow();
    }, 15000);
});
