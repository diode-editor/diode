import { describe, expect, it } from "vitest";

import type { MacKeysRung } from "../../../../platform/keybinding/common/macKeys.ts";

import {
    canUpgradeToMac,
    type CapabilitySet,
    detectBaseModes,
    detectExtendedKeysHint,
    detectKittyGraphicsHint,
    detectTruecolor,
    emptyCapabilities,
    isMacOnlyTerminal,
    type OsName,
    type OsSignals,
    type ResolvedOs,
    resolveMacKeysRung,
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

    describe("resolveOs: signal ladder with provenance", () => {
        const base: OsSignals = { platform: "linux", ssh: false };

        it.each<[string, OsSignals, ResolvedOs]>([
            ["no signals ⇒ `unknown`, non-mac", base, { os: "linux", source: "default" }],
            ["local darwin ⇒ mac", { platform: "darwin", ssh: false }, { os: "mac", source: "platform" }],
            ["local win32 ⇒ windows", { platform: "win32", ssh: false }, { os: "windows", source: "platform" }],
            ["freebsd ⇒ non-mac by default", { platform: "freebsd", ssh: false }, { os: "linux", source: "default" }],
            [
                "ssh into darwin without signals ⇒ not mac (could come from a PC)",
                { platform: "darwin", ssh: true },
                { os: "linux", source: "default" },
            ],
            [
                "ssh into win32 without signals ⇒ non-mac by default",
                { platform: "win32", ssh: true },
                { os: "linux", source: "default" },
            ],
            [
                "LC_DIODE_PLATFORM=mac over ssh on Linux ⇒ mac",
                { ...base, ssh: true, envPlatform: "mac" },
                { os: "mac", source: "env" },
            ],
            ["LC_DIODE_PLATFORM is case-insensitive", { ...base, envPlatform: " Mac " }, { os: "mac", source: "env" }],
            [
                "LC_DIODE_PLATFORM=linux overrides darwin",
                { platform: "darwin", ssh: false, envPlatform: "linux" },
                { os: "linux", source: "env" },
            ],
            [
                "garbage in LC_DIODE_PLATFORM is ignored",
                { ...base, envPlatform: "macos" },
                { os: "linux", source: "default" },
            ],
            [
                "LC_TERMINAL=iTerm2 ⇒ mac",
                { ...base, ssh: true, lcTerminal: "iTerm2" },
                { os: "mac", source: "terminal" },
            ],
            [
                "XTVERSION Apple_Terminal ⇒ mac",
                { ...base, terminalName: "Apple_Terminal" },
                { os: "mac", source: "terminal" },
            ],
            [
                "XTVERSION iTerm2 with a version ⇒ mac",
                { ...base, terminalName: "iTerm2 3.5.0" },
                { os: "mac", source: "terminal" },
            ],
            [
                "kitty is not mac-only: positive signals only ⇒ `unknown`",
                { ...base, terminalName: "kitty(0.45.0)" },
                { os: "linux", source: "default" },
            ],
            [
                "the setting overrides everything",
                { platform: "darwin", ssh: false, setting: "linux", envPlatform: "mac", lcTerminal: "iTerm2" },
                { os: "linux", source: "setting" },
            ],
            ["setting mac on Linux", { ...base, setting: "mac" }, { os: "mac", source: "setting" }],
            [
                "setting auto: the signals below decide",
                { ...base, setting: "auto", envPlatform: "mac" },
                { os: "mac", source: "env" },
            ],
            [
                "ssh + darwin does not override an explicit value",
                { platform: "darwin", ssh: true, envPlatform: "windows" },
                { os: "windows", source: "env" },
            ],
        ])("%s", (_name, signals, expected) => {
            expect(resolveOs(signals)).toEqual(expected);
        });
    });

    describe("canUpgradeToMac: a late signal flips only toward mac", () => {
        const mac: ResolvedOs = { os: "mac", source: "terminal" };
        it.each<[string, ResolvedOs, ResolvedOs, boolean]>([
            ["default → mac", { os: "linux", source: "default" }, mac, true],
            ["platform (win32) → mac", { os: "windows", source: "platform" }, mac, true],
            ["mac → linux never", mac, { os: "linux", source: "env" }, false],
            ["mac → mac is not a change", { os: "mac", source: "platform" }, mac, false],
            ["an explicit setting is not overridden", { os: "linux", source: "setting" }, mac, false],
            ["an explicit variable is not overridden", { os: "linux", source: "env" }, mac, false],
            [
                "non-mac → non-mac is not a flip",
                { os: "linux", source: "default" },
                { os: "windows", source: "env" },
                false,
            ],
        ])("%s", (_name, current, next, expected) => {
            expect(canUpgradeToMac(current, next)).toBe(expected);
        });
    });

    describe("isMacOnlyTerminal", () => {
        it("recognizes mac-only terminals by prefix and does not know the rest", () => {
            expect(isMacOnlyTerminal("iTerm2")).toBe(true);
            expect(isMacOnlyTerminal("  apple_terminal 455")).toBe(true);
            expect(isMacOnlyTerminal("WezTerm 20240203")).toBe(false);
            expect(isMacOnlyTerminal("")).toBe(false);
            expect(isMacOnlyTerminal(undefined)).toBe(false);
        });
    });

    describe("resolveMacKeysRung: `environment → rung` table", () => {
        const none = new Set<string>(["local"]);
        const tmux = new Set<string>(["local", "tmux"]);
        it.each<[string, OsName, Partial<CapabilitySet>, ReadonlySet<string>, MacKeysRung | undefined]>([
            ["not mac ⇒ no rung", "linux", { super: true, "extended-keys": true }, none, undefined],
            ["Terminal.app: nothing ⇒ legacy", "mac", {}, none, "legacy"],
            ["default tmux (extended-keys off) ⇒ legacy", "mac", {}, tmux, "legacy"],
            ["tmux c extended-keys ⇒ extended", "mac", { "extended-keys": true }, tmux, "extended"],
            [
                "kitty without tmux, super not seen yet ⇒ extended",
                "mac",
                { "extended-keys": true, "kitty-graphics": true },
                none,
                "extended",
            ],
            [
                "kitty without tmux, super arrives ⇒ cmd",
                "mac",
                { "extended-keys": true, "kitty-graphics": true, super: true },
                none,
                "cmd",
            ],
            [
                "kitty + tmux ⇒ Cmd off even with a forced super",
                "mac",
                { "extended-keys": true, "kitty-graphics": true, super: true },
                tmux,
                "extended",
            ],
        ])("%s", (_name, os, capabilities, modes, expected) => {
            expect(resolveMacKeysRung(os, caps(capabilities), modes)).toBe(expected);
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
            // $TERM masked (ssh), but the terminal's env flag survived forwarding.
            expect(detectExtendedKeysHint({ TERM: "screen-256color", KITTY_WINDOW_ID: "1" })).toBe(true);
            expect(detectExtendedKeysHint({ TERM: "xterm-256color" })).toBe(false);
        });

        // Under a multiplexer extended keys get through only if tmux itself passes
        // them; the host terminal's env flag says nothing about that. An overstated
        // hint cost both the chord (Ctrl+Shift+F arrived as Ctrl+F) and the legacy fallback.
        it("does not trust the terminal's env flags inside tmux", () => {
            expect(
                detectExtendedKeysHint({
                    TERM: "tmux-256color",
                    TERM_PROGRAM: "tmux",
                    KITTY_WINDOW_ID: "1",
                    TMUX: "/tmp/tmux-1000/default,1,0",
                }),
            ).toBe(false);
            expect(
                detectExtendedKeysHint({
                    TERM: "tmux-256color",
                    WEZTERM_PANE: "0",
                    TMUX: "/tmp/tmux-1000/default,1,0",
                }),
            ).toBe(false);
        });

        // An explicit $TERM inside tmux is the user's own setting (`default-terminal`),
        // not an inherited flag, so it is trusted.
        it("trusts an explicit $TERM even inside tmux", () => {
            expect(detectExtendedKeysHint({ TERM: "xterm-kitty", TMUX: "/tmp/tmux-1000/default,1,0" })).toBe(true);
        });
    });
});
