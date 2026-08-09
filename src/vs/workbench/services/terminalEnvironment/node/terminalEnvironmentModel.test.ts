import { describe, expect, it } from "vitest";

import {
    type CapabilitySet,
    detectBaseModes,
    detectExtendedKeysHint,
    detectKittyGraphicsHint,
    detectTruecolor,
    emptyCapabilities,
    resolveOs,
    resolveTier,
    tierAtLeast,
} from "./terminalEnvironmentModel.ts";

function caps(overrides: Partial<CapabilitySet>): CapabilitySet {
    return { ...emptyCapabilities(), ...overrides };
}

describe("TerminalEnvironmentModel", () => {
    describe("resolveTier", () => {
        it("returns legacy with no capabilities", () => {
            expect(resolveTier(emptyCapabilities())).toBe("legacy");
        });

        it("returns csi-u with extended-keys only", () => {
            expect(resolveTier(caps({ "extended-keys": true }))).toBe("csi-u");
        });

        it("returns kitty with extended-keys + kitty-graphics", () => {
            expect(resolveTier(caps({ "extended-keys": true, "kitty-graphics": true }))).toBe("kitty");
        });

        it("stays legacy when only graphics is present (no extended-keys)", () => {
            expect(resolveTier(caps({ "kitty-graphics": true }))).toBe("legacy");
        });
    });

    describe("tierAtLeast", () => {
        it("orders legacy < csi-u < kitty", () => {
            expect(tierAtLeast("kitty", "csi-u")).toBe(true);
            expect(tierAtLeast("csi-u", "csi-u")).toBe(true);
            expect(tierAtLeast("legacy", "csi-u")).toBe(false);
        });
    });

    describe("resolveOs", () => {
        it("maps platforms", () => {
            expect(resolveOs("darwin")).toBe("mac");
            expect(resolveOs("win32")).toBe("windows");
            expect(resolveOs("linux")).toBe("linux");
            expect(resolveOs("freebsd")).toBe("linux");
        });
    });

    describe("detectBaseModes", () => {
        it("is local when not ssh and not tmux", () => {
            const modes = detectBaseModes({});
            expect([...modes]).toEqual(["local"]);
        });

        it("is ssh (not local) over SSH_CONNECTION", () => {
            const modes = detectBaseModes({ SSH_CONNECTION: "1.2.3.4 22 5.6.7.8 22" });
            expect(modes.has("ssh")).toBe(true);
            expect(modes.has("local")).toBe(false);
        });

        it("adds tmux when $TMUX is set", () => {
            const modes = detectBaseModes({ TMUX: "/tmp/tmux-1000/default,1,0" });
            expect(modes.has("tmux")).toBe(true);
            expect(modes.has("local")).toBe(true);
        });
    });

    describe("capability hints", () => {
        it("detects truecolor from $COLORTERM", () => {
            expect(detectTruecolor({ COLORTERM: "truecolor" })).toBe(true);
            expect(detectTruecolor({ COLORTERM: "24bit" })).toBe(true);
            expect(detectTruecolor({ COLORTERM: "" })).toBe(false);
            expect(detectTruecolor({})).toBe(false);
        });

        it("infers kitty-graphics hint from $TERM / $TERM_PROGRAM", () => {
            expect(detectKittyGraphicsHint({ TERM: "xterm-kitty" })).toBe(true);
            expect(detectKittyGraphicsHint({ TERM_PROGRAM: "ghostty" })).toBe(true);
            expect(detectKittyGraphicsHint({ TERM: "xterm-256color" })).toBe(false);
        });

        it("infers extended-keys from known terminals and their env flags", () => {
            expect(detectExtendedKeysHint({ TERM: "xterm-kitty" })).toBe(true);
            expect(detectExtendedKeysHint({ TERM: "foot" })).toBe(true);
            expect(detectExtendedKeysHint({ TERM_PROGRAM: "WezTerm" })).toBe(true);
            // $TERM masked (ssh), но env-флаг терминала пережил проброс.
            expect(detectExtendedKeysHint({ TERM: "screen-256color", KITTY_WINDOW_ID: "1" })).toBe(true);
            expect(detectExtendedKeysHint({ TERM: "xterm-256color" })).toBe(false);
        });

        // Под мультиплексором расширенные клавиши доходят, только если их пропускает
        // сам tmux; env-флаг хост-терминала об этом ничего не говорит. Завышенный
        // хинт стоил и комбинации (Ctrl+Shift+F приезжал как Ctrl+F), и legacy-фоллбэка.
        it("не верит env-флагам терминала внутри tmux", () => {
            expect(
                detectExtendedKeysHint({ TERM: "tmux-256color", TERM_PROGRAM: "tmux", KITTY_WINDOW_ID: "1", TMUX: "/tmp/tmux-1000/default,1,0" }),
            ).toBe(false);
            expect(detectExtendedKeysHint({ TERM: "tmux-256color", WEZTERM_PANE: "0", TMUX: "/tmp/tmux-1000/default,1,0" })).toBe(false);
        });

        // Явный $TERM внутри tmux — это уже настройка пользователя (`default-terminal`),
        // а не унаследованный флаг: ей верим.
        it("верит явному $TERM даже внутри tmux", () => {
            expect(detectExtendedKeysHint({ TERM: "xterm-kitty", TMUX: "/tmp/tmux-1000/default,1,0" })).toBe(true);
        });
    });
});
