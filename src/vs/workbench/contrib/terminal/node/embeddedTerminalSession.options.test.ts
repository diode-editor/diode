import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { describe, expect, it, vi } from "vitest";

import { buildEnv, EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// Опции шелла терминала расширения (`TerminalOptions`): окружение, `strictEnv`,
// `message` и pid. Окружение проверяем и чистой функцией, и настоящим шеллом —
// что дошло до процесса, видно только в его выводе.

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
    it("поверх базы: строки задают, null снимает; TERM наш, TMUX снят всегда", () => {
        expect(
            buildEnv(
                { KEEP: "1", DROP: "2", TERM: "dumb", TMUX: "/tmp/tmux" },
                { ADD: "3", DROP: null, TMUX: "again" },
            ),
        ).toEqual({ KEEP: "1", ADD: "3", TERM: "xterm-256color" });
        expect(buildEnv({ A: "1" }, undefined)).toEqual({ A: "1", TERM: "xterm-256color" });
    });
});

describe("EmbeddedTerminalSession — опции терминала расширения", () => {
    it("env доходит до шелла, null снимает унаследованную переменную, pid — процесса шелла", async () => {
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

    it("strictEnv: унаследованного нет, только env терминала", async () => {
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
                expect(screen(session, 6, 60)).toContain("[|mine]");
            },
            { timeout: 5000, interval: 50 },
        );
        session.dispose();
    }, 15000);

    it("message печатается первой строкой, до вывода шелла, и в шелл не уходит", async () => {
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
});
