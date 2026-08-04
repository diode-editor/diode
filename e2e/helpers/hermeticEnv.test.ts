import { afterEach, describe, expect, it } from "vitest";

import { hermeticSpawnEnv } from "./hermeticEnv.ts";

// Регрессия к падению сценария encoding: e2e-спаун наследовал терминальные
// маркеры хоста (kitty ssh-kitten внутри tmux → `KITTY_WINDOW_ID` → tier
// csi-u), и chord-фоллбэк палитры `when: "tier == 'legacy'"` молча умирал —
// на CI (без маркеров) тот же сценарий был зелёным.

const HOST_MARKERS: Record<string, string> = {
    KITTY_WINDOW_ID: "1",
    GHOSTTY_RESOURCES_DIR: "/tmp/ghostty",
    WEZTERM_PANE: "7",
    ALACRITTY_WINDOW_ID: "3",
    TERM_PROGRAM: "tmux",
    TERM_PROGRAM_VERSION: "3.4",
    COLORTERM: "truecolor",
    TMUX: "/tmp/tmux-1000/default,1,0",
    TMUX_PANE: "%1",
    SSH_TTY: "/dev/pts/0",
    SSH_CONNECTION: "10.0.0.1 1 10.0.0.2 22",
    SSH_CLIENT: "10.0.0.1 1 22",
};

describe("hermeticSpawnEnv", () => {
    const saved = new Map<string, string | undefined>();

    function pollute(vars: Record<string, string>): void {
        for (const [key, value] of Object.entries(vars)) {
            if (!saved.has(key)) saved.set(key, process.env[key]);
            process.env[key] = value;
        }
    }

    afterEach(() => {
        for (const [key, value] of saved) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        saved.clear();
    });

    it("strips host terminal-identity markers and pins TERM", () => {
        pollute({ ...HOST_MARKERS, TERM: "tmux-256color" });

        const env = hermeticSpawnEnv();

        for (const key of Object.keys(HOST_MARKERS)) expect(env[key]).toBeUndefined();
        expect(env.TERM).toBe("xterm-256color");
        expect(env.PATH).toBe(process.env.PATH);
    });

    it("keeps caller overrides but sanitizes them last", () => {
        pollute({ TERM: "tmux-256color" });

        // Часть вызывающих спредит в extra целый process.env (selfextract) —
        // маркеры не должны воскресать и через этот путь.
        const env = hermeticSpawnEnv({ ...HOST_MARKERS, HOME: "/isolated/home" });

        expect(env.HOME).toBe("/isolated/home");
        for (const key of Object.keys(HOST_MARKERS)) expect(env[key]).toBeUndefined();
        expect(env.TERM).toBe("xterm-256color");
    });
});
