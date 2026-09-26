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

    describe("resolveOs — лестница сигналов с провенансом", () => {
        const base: OsSignals = { platform: "linux", ssh: false };

        it.each<[string, OsSignals, ResolvedOs]>([
            ["сигналов нет ⇒ «не знаю», не-мак", base, { os: "linux", source: "default" }],
            ["локальный darwin ⇒ мак", { platform: "darwin", ssh: false }, { os: "mac", source: "platform" }],
            ["локальный win32 ⇒ windows", { platform: "win32", ssh: false }, { os: "windows", source: "platform" }],
            ["freebsd ⇒ не-мак по умолчанию", { platform: "freebsd", ssh: false }, { os: "linux", source: "default" }],
            [
                "ssh в darwin без сигналов ⇒ не мак (могли зайти с PC)",
                { platform: "darwin", ssh: true },
                { os: "linux", source: "default" },
            ],
            [
                "ssh в win32 без сигналов ⇒ не-мак по умолчанию",
                { platform: "win32", ssh: true },
                { os: "linux", source: "default" },
            ],
            [
                "LC_DIODE_PLATFORM=mac по ssh на Linux ⇒ мак",
                { ...base, ssh: true, envPlatform: "mac" },
                { os: "mac", source: "env" },
            ],
            ["LC_DIODE_PLATFORM регистронезависим", { ...base, envPlatform: " Mac " }, { os: "mac", source: "env" }],
            [
                "LC_DIODE_PLATFORM=linux перебивает darwin",
                { platform: "darwin", ssh: false, envPlatform: "linux" },
                { os: "linux", source: "env" },
            ],
            [
                "мусор в LC_DIODE_PLATFORM игнорируется",
                { ...base, envPlatform: "macos" },
                { os: "linux", source: "default" },
            ],
            [
                "LC_TERMINAL=iTerm2 ⇒ мак",
                { ...base, ssh: true, lcTerminal: "iTerm2" },
                { os: "mac", source: "terminal" },
            ],
            [
                "XTVERSION Apple_Terminal ⇒ мак",
                { ...base, terminalName: "Apple_Terminal" },
                { os: "mac", source: "terminal" },
            ],
            [
                "XTVERSION iTerm2 с версией ⇒ мак",
                { ...base, terminalName: "iTerm2 3.5.0" },
                { os: "mac", source: "terminal" },
            ],
            [
                "kitty не маковский: только позитив ⇒ «не знаю»",
                { ...base, terminalName: "kitty(0.45.0)" },
                { os: "linux", source: "default" },
            ],
            [
                "настройка перебивает всё",
                { platform: "darwin", ssh: false, setting: "linux", envPlatform: "mac", lcTerminal: "iTerm2" },
                { os: "linux", source: "setting" },
            ],
            ["настройка mac на Linux", { ...base, setting: "mac" }, { os: "mac", source: "setting" }],
            [
                "настройка auto — сигналы ниже решают",
                { ...base, setting: "auto", envPlatform: "mac" },
                { os: "mac", source: "env" },
            ],
            [
                "ssh + darwin не перебивает явное",
                { platform: "darwin", ssh: true, envPlatform: "windows" },
                { os: "windows", source: "env" },
            ],
        ])("%s", (_name, signals, expected) => {
            expect(resolveOs(signals)).toEqual(expected);
        });
    });

    describe("canUpgradeToMac — поздний сигнал переворачивает только к маку", () => {
        const mac: ResolvedOs = { os: "mac", source: "terminal" };
        it.each<[string, ResolvedOs, ResolvedOs, boolean]>([
            ["default → mac", { os: "linux", source: "default" }, mac, true],
            ["platform (win32) → mac", { os: "windows", source: "platform" }, mac, true],
            ["mac → linux никогда", mac, { os: "linux", source: "env" }, false],
            ["mac → mac — не изменение", { os: "mac", source: "platform" }, mac, false],
            ["явная настройка не перебивается", { os: "linux", source: "setting" }, mac, false],
            ["явная переменная не перебивается", { os: "linux", source: "env" }, mac, false],
            [
                "не-мак → не-мак — не переворот",
                { os: "linux", source: "default" },
                { os: "windows", source: "env" },
                false,
            ],
        ])("%s", (_name, current, next, expected) => {
            expect(canUpgradeToMac(current, next)).toBe(expected);
        });
    });

    describe("isMacOnlyTerminal", () => {
        it("узнаёт маковские терминалы по префиксу и не знает остальных", () => {
            expect(isMacOnlyTerminal("iTerm2")).toBe(true);
            expect(isMacOnlyTerminal("  apple_terminal 455")).toBe(true);
            expect(isMacOnlyTerminal("WezTerm 20240203")).toBe(false);
            expect(isMacOnlyTerminal("")).toBe(false);
            expect(isMacOnlyTerminal(undefined)).toBe(false);
        });
    });

    describe("resolveMacKeysRung — таблица «окружение → рунг»", () => {
        const none = new Set<string>(["local"]);
        const tmux = new Set<string>(["local", "tmux"]);
        it.each<[string, OsName, Partial<CapabilitySet>, ReadonlySet<string>, MacKeysRung | undefined]>([
            ["не мак ⇒ нет рунга", "linux", { super: true, "extended-keys": true }, none, undefined],
            ["Terminal.app: ничего ⇒ legacy", "mac", {}, none, "legacy"],
            ["tmux дефолтный (extended-keys off) ⇒ legacy", "mac", {}, tmux, "legacy"],
            ["tmux c extended-keys ⇒ extended", "mac", { "extended-keys": true }, tmux, "extended"],
            [
                "kitty без tmux, super ещё не видели ⇒ extended",
                "mac",
                { "extended-keys": true, "kitty-graphics": true },
                none,
                "extended",
            ],
            [
                "kitty без tmux, super доезжает ⇒ cmd",
                "mac",
                { "extended-keys": true, "kitty-graphics": true, super: true },
                none,
                "cmd",
            ],
            [
                "kitty + tmux ⇒ Cmd выключен даже с форсированным super",
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
            // $TERM masked (ssh), но env-флаг терминала пережил проброс.
            expect(detectExtendedKeysHint({ TERM: "screen-256color", KITTY_WINDOW_ID: "1" })).toBe(true);
            expect(detectExtendedKeysHint({ TERM: "xterm-256color" })).toBe(false);
        });

        // Под мультиплексором расширенные клавиши доходят, только если их пропускает
        // сам tmux; env-флаг хост-терминала об этом ничего не говорит. Завышенный
        // хинт стоил и комбинации (Ctrl+Shift+F приезжал как Ctrl+F), и legacy-фоллбэка.
        it("не верит env-флагам терминала внутри tmux", () => {
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

        // Явный $TERM внутри tmux — это уже настройка пользователя (`default-terminal`),
        // а не унаследованный флаг: ей верим.
        it("верит явному $TERM даже внутри tmux", () => {
            expect(detectExtendedKeysHint({ TERM: "xterm-kitty", TMUX: "/tmp/tmux-1000/default,1,0" })).toBe(true);
        });
    });
});
