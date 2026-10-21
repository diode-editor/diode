import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { describe, expect, it, vi } from "vitest";

import type { ITerminalEnvironmentContributor } from "../common/extensionEnvironment.ts";

import { buildEnv, EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

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

function contributor() {
    const calls: { env: Record<string, string | undefined>; cwd: string }[] = [];
    const environment: ITerminalEnvironmentContributor = {
        apply: (env, cwd) => {
            calls.push({ env: { ...env }, cwd });
            env.DIODE_EXT_VAR = `ext-${String(calls.length)}`;
            env.DIODE_EXT_PATH = `${env.DIODE_EXT_PATH ?? ""}:ext`;
            env.TERM = "ext-term";
        },
    };
    return { environment, calls };
}

describe("buildEnv — collection overlay", () => {
    it("sees the base with the terminal `env` (unset ones already gone), its edits land in the environment, TERM/TMUX are ours", () => {
        let seen: Record<string, string | undefined> | undefined;
        const env = buildEnv({ KEEP: "1", DROP: "2", TMUX: "t" }, { ADD: "3", DROP: null }, (target) => {
            seen = { ...target };
            target.FROM_EXT = "x";
            target.TMUX = "ext";
            target.TERM = "ext";
            target.UNSET = undefined;
        });
        expect(seen).toEqual({ KEEP: "1", ADD: "3", TMUX: "t" });
        // Strict: a variable the contributor left `undefined` doesn't reach the environment at all.
        expect(env).toStrictEqual({ KEEP: "1", ADD: "3", FROM_EXT: "x", TERM: "xterm-256color" });
    });
});

describe("EmbeddedTerminalSession — extension environment collections", () => {
    it("the overlay reaches the shell and is called with the launch cwd; on relaunch again, on a fresh environment", async () => {
        const { environment, calls } = contributor();
        vi.stubEnv("DIODE_EXT_PATH", "/base");
        const session = new EmbeddedTerminalSession(
            {
                cols: 60,
                rows: 6,
                shell: "/bin/sh",
                args: ["-c", 'echo "[$DIODE_EXT_VAR|$DIODE_EXT_PATH|$TERM]"'],
                cwd: "/tmp",
            },
            environment,
        );
        await awaitExit(session);
        await vi.waitFor(() => {
            expect(screen(session, 6, 60)).toContain("[ext-1|/base:ext|xterm-256color]");
        });
        session.relaunch({ shell: "/bin/sh", args: ["-c", 'echo "<$DIODE_EXT_VAR|$DIODE_EXT_PATH>"'], cwd: "/" });
        await awaitExit(session);
        vi.unstubAllEnvs();
        await vi.waitFor(() => {
            expect(screen(session, 6, 60)).toContain("<ext-2|/base:ext>");
        });
        expect(calls.map((c) => c.cwd)).toEqual(["/tmp", "/"]);
        expect(calls[1]?.env.DIODE_EXT_PATH).toBe("/base");
        session.dispose();
    }, 20000);

    it("cwd defaults to the process directory", async () => {
        const { environment, calls } = contributor();
        const session = new EmbeddedTerminalSession(
            { cols: 40, rows: 4, shell: "/bin/sh", args: ["-c", "exit 0"] },
            environment,
        );
        await awaitExit(session);
        expect(calls.map((c) => c.cwd)).toEqual([process.cwd()]);
        session.dispose();
    }, 20000);

    it("strictEnv — the overlay isn't called, the environment is exactly `env`", async () => {
        const { environment, calls } = contributor();
        const session = new EmbeddedTerminalSession(
            {
                cols: 60,
                rows: 6,
                shell: "/bin/sh",
                args: ["-c", 'echo "[${DIODE_EXT_VAR:-none}|$ONLY]"'],
                env: { ONLY: "only", PATH: process.env.PATH ?? "" },
                strictEnv: true,
            },
            environment,
        );
        await awaitExit(session);
        await vi.waitFor(() => {
            expect(screen(session, 6, 60)).toContain("[none|only]");
        });
        expect(calls).toEqual([]);
        session.dispose();
    }, 20000);
});
