import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { describe, expect, it, vi } from "vitest";

import { VSCODE_SHIM_VERSION } from "../../../api/common/vscodeShimVersion.ts";

import { buildEnv, EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

const VSCODE_KEYS = { TERM_PROGRAM: "vscode", TERM_PROGRAM_VERSION: VSCODE_SHIM_VERSION, COLORTERM: "truecolor" };

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
        ).toEqual({ KEEP: "1", ADD: "3", TERM: "xterm-256color", ...VSCODE_KEYS });
        expect(buildEnv({ A: "1" }, undefined)).toEqual({ A: "1", TERM: "xterm-256color", ...VSCODE_KEYS });
    });

    it("inherited VS Code/Electron variables are dropped (upstream sanitizeProcessEnvironment), the allowed ones stay", () => {
        const inherited = {
            VSCODE_FOO: "x",
            VSCODE_NONCE: "x",
            ELECTRON_RUN_AS_NODE: "1",
            SNAP: "/snap/x",
            SNAP_NAME: "code",
            GDK_PIXBUF_MODULE_FILE: "x",
            VSCODE_IPC_HOOK_CLI: "/tmp/ipc.sock",
            VSCODE_PORTABLE: "p",
            VSCODE_SHELL_LOGIN: "1",
            VSCODE_ENV_REPLACE: "r",
            VSCODE_ENV_APPEND: "a",
            VSCODE_ENV_PREPEND: "p",
            // Look-alikes that don't match the patterns.
            ELECTRON_: "e",
            SNAPSHOT: "s",
            MY_VSCODE_FOO: "m",
        };
        expect(buildEnv(inherited, undefined)).toStrictEqual({
            VSCODE_IPC_HOOK_CLI: "/tmp/ipc.sock",
            VSCODE_PORTABLE: "p",
            VSCODE_SHELL_LOGIN: "1",
            VSCODE_ENV_REPLACE: "r",
            VSCODE_ENV_APPEND: "a",
            VSCODE_ENV_PREPEND: "p",
            ELECTRON_: "e",
            SNAPSHOT: "s",
            MY_VSCODE_FOO: "m",
            ...VSCODE_KEYS,
            TERM: "xterm-256color",
        });
    });

    it("the terminal `env` is applied after sanitizing: an explicit VSCODE_X stays, its TERM_PROGRAM is overridden", () => {
        expect(
            buildEnv(
                { VSCODE_X: "inherited" },
                { VSCODE_X: "1", TERM_PROGRAM: "kitty", TERM_PROGRAM_VERSION: "0.1", COLORTERM: "24bit" },
            ),
        ).toStrictEqual({ VSCODE_X: "1", ...VSCODE_KEYS, TERM: "xterm-256color" });
    });

    it("strictEnv (no inherited environment): exactly `env`, neither sanitized nor given the VS Code keys", () => {
        expect(buildEnv(undefined, { VSCODE_X: "1", ELECTRON_Y: "2", TERM_PROGRAM: "kitty", TMUX: "t" })).toStrictEqual(
            {
                VSCODE_X: "1",
                ELECTRON_Y: "2",
                TERM_PROGRAM: "kitty",
                TERM: "xterm-256color",
            },
        );
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

    it("the shell sees TERM_PROGRAM=vscode and COLORTERM, not inherited VSCODE_* or the outer TERM_PROGRAM", async () => {
        vi.stubEnv("VSCODE_DIODE_LEAK", "leak");
        vi.stubEnv("TERM_PROGRAM", "kitty");
        const session = new EmbeddedTerminalSession({
            cols: 60,
            rows: 6,
            shell: "/bin/sh",
            args: ["-c", 'echo "[$TERM_PROGRAM|$TERM_PROGRAM_VERSION|$COLORTERM|$VSCODE_DIODE_LEAK]"'],
        });
        vi.unstubAllEnvs();
        await awaitExit(session);
        await vi.waitFor(
            () => {
                expect(screen(session, 6, 60)).toContain(`[vscode|${VSCODE_SHIM_VERSION}|truecolor|]`);
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
