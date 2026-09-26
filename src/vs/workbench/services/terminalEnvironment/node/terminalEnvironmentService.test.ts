import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigurationModel } from "../../../../platform/configuration/common/configurationModel.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { ConfigurationService } from "../../../../platform/configuration/node/configurationService.ts";
import { terminalConfiguration } from "../../../common/configuration/terminalConfiguration.ts";

import { TerminalEnvironmentService } from "./terminalEnvironmentService.ts";
import type { TmuxClientInfo } from "./tmuxClientProbe.ts";

function configFrom(userRaw: Record<string, unknown> = {}): IConfigurationService {
    return new ConfigurationService({
        defaultsLayer: ConfigurationModel.fromRaw(
            new ConfigurationRegistry([terminalConfiguration]).getDefaultConfiguration(),
        ),
        userLayer: ConfigurationModel.fromRaw(userRaw),
        profileLayer: ConfigurationModel.EMPTY,
    });
}

describe("TerminalEnvironmentService", () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        // Deterministic ambient environment for the constructor's sync detection.
        delete process.env.TMUX;
        delete process.env.SSH_CONNECTION;
        delete process.env.SSH_TTY;
        delete process.env.COLORTERM;
        delete process.env.KITTY_WINDOW_ID;
        delete process.env.GHOSTTY_RESOURCES_DIR;
        delete process.env.WEZTERM_PANE;
        delete process.env.ALACRITTY_WINDOW_ID;
        delete process.env.TERM_PROGRAM;
        delete process.env.LC_DIODE_PLATFORM;
        delete process.env.LC_TERMINAL;
        process.env.TERM = "xterm-256color";
    });

    afterEach(() => {
        process.env = savedEnv;
    });

    describe("synchronous detection (no probe, no waiting)", () => {
        it("resolves kitty tier immediately from $TERM=xterm-kitty", () => {
            process.env.TERM = "xterm-kitty";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            expect(service.tier).toBe("kitty");
            expect(service.hasCapability("extended-keys")).toBe(true);
        });

        it("resolves legacy tier for a plain xterm-256color terminal", () => {
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            expect(service.tier).toBe("legacy");
            expect(service.hasCapability("extended-keys")).toBe(false);
        });

        it("picks up extended-keys from an env flag even when $TERM is masked (e.g. inside tmux)", () => {
            process.env.TERM = "tmux-256color";
            process.env.KITTY_WINDOW_ID = "1";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            // extended-keys via env flag, but no graphics hint → csi-u.
            expect(service.tier).toBe("csi-u");
        });
    });

    describe("fire-and-forget probe (upgrade-only)", () => {
        it("upgrades legacy → csi-u when the probe confirms keyboard-protocol support", () => {
            const backend = new MockTerminalBackend();
            const service = new TerminalEnvironmentService(backend, configFrom());
            let changed = 0;
            service.onDidChange(() => changed++);

            expect(service.tier).toBe("legacy");
            service.detect();
            backend.resolveKeyboardProtocol(true);

            expect(service.hasCapability("extended-keys")).toBe(true);
            expect(service.tier).toBe("csi-u");
            expect(changed).toBe(1);
        });

        it("does nothing when the probe reports no support", () => {
            const backend = new MockTerminalBackend();
            const service = new TerminalEnvironmentService(backend, configFrom());
            let changed = 0;
            service.onDidChange(() => changed++);

            service.detect();
            backend.resolveKeyboardProtocol(false);

            expect(service.tier).toBe("legacy");
            expect(changed).toBe(0);
        });

        it("upgrades the capability without firing onDidChange when a forced tier pins the result", () => {
            // Probe upgrades extended-keys, but terminal.tier forces the tier, so the
            // resolved tier equals the current one → the change is swallowed (no emit).
            const backend = new MockTerminalBackend();
            const service = new TerminalEnvironmentService(backend, configFrom({ terminal: { tier: "csi-u" } }));
            let changed = 0;
            service.onDidChange(() => changed++);

            expect(service.tier).toBe("csi-u");
            expect(service.hasCapability("extended-keys")).toBe(false);

            service.detect();
            backend.resolveKeyboardProtocol(true);

            expect(service.hasCapability("extended-keys")).toBe(true);
            expect(service.tier).toBe("csi-u");
            expect(changed).toBe(0);
        });

        it("never downgrades — a non-reply keeps an env-detected capability", () => {
            process.env.TERM = "xterm-kitty";
            const backend = new MockTerminalBackend();
            const service = new TerminalEnvironmentService(backend, configFrom());

            service.detect();
            backend.resolveKeyboardProtocol(false);

            expect(service.tier).toBe("kitty");
        });
    });

    describe("runtime detection from observed CSI-u input (noteExtendedKeysObserved)", () => {
        it("upgrades legacy → csi-u on the first observed extended key", () => {
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            let changed = 0;
            service.onDidChange(() => changed++);

            expect(service.tier).toBe("legacy");
            service.noteExtendedKeysObserved();

            expect(service.hasCapability("extended-keys")).toBe(true);
            expect(service.tier).toBe("csi-u");
            expect(changed).toBe(1);
        });

        it("is idempotent — a second observation does not emit again", () => {
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            let changed = 0;
            service.onDidChange(() => changed++);

            service.noteExtendedKeysObserved();
            service.noteExtendedKeysObserved();

            expect(changed).toBe(1);
        });

        it("upgrades the capability but does not emit when a forced tier pins the result", () => {
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                configFrom({ terminal: { tier: "csi-u" } }),
            );
            let changed = 0;
            service.onDidChange(() => changed++);

            service.noteExtendedKeysObserved();

            expect(service.hasCapability("extended-keys")).toBe(true);
            expect(service.tier).toBe("csi-u");
            expect(changed).toBe(0);
        });
    });

    describe("config overrides", () => {
        it("forces the tier regardless of detection", () => {
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                configFrom({ terminal: { tier: "kitty" } }),
            );
            expect(service.tier).toBe("kitty");
        });

        it("forces a capability off", () => {
            process.env.TERM = "xterm-kitty";
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                configFrom({ terminal: { capabilities: { osc52: false } } }),
            );
            expect(service.hasCapability("osc52")).toBe(false);
        });

        it("ignores capability overrides that are unknown or non-boolean", () => {
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                // `bogus` is not a known capability; `osc52` is, but its value is not a boolean.
                configFrom({ terminal: { capabilities: { bogus: true, osc52: "nope" } } as never }),
            );
            // osc52 keeps its env-derived default (true outside tmux); the bad entries are skipped.
            expect(service.hasCapability("osc52")).toBe(true);
        });
    });

    describe("modes", () => {
        it("forces modes off via config and reports active modes", () => {
            process.env.TMUX = "/tmp/x,1,0";
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                configFrom({ terminal: { modes: { tmux: false } } }),
            );
            expect(service.isModeActive("tmux")).toBe(false);
            expect(service.isModeActive("local")).toBe(true);
        });

        it("toggles a mode at runtime and notifies listeners", () => {
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            let fired = 0;
            service.onDidChange(() => fired++);

            expect(service.isModeActive("presentation")).toBe(false);
            service.setMode("presentation", true);
            expect(service.isModeActive("presentation")).toBe(true);
            expect(fired).toBe(1);
        });

        it("setMode is a no-op when the mode already holds the requested value", () => {
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            let fired = 0;
            service.onDidChange(() => fired++);

            service.setMode("presentation", true); // first toggle fires
            service.setMode("presentation", true); // same value → early return, no emit

            expect(service.isModeActive("presentation")).toBe(true);
            expect(fired).toBe(1);
        });

        it("exposes declared custom modes for context-key registration", () => {
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                configFrom({ terminal: { customModes: { presentation: {}, ci: {} } } }),
            );
            expect(service.getKnownModeNames()).toEqual(
                expect.arrayContaining(["local", "ssh", "tmux", "presentation", "ci"]),
            );
        });

        it("getActiveModes adds a forced-on mode and removes a forced-off base mode", () => {
            process.env.TMUX = "/tmp/x,1,0"; // tmux is a base mode
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());

            // Force a non-base mode ON and force the base "tmux" mode OFF at runtime.
            service.setMode("presentation", true);
            service.setMode("tmux", false);

            const active = service.getActiveModes();
            expect(active.has("local")).toBe(true); // base mode untouched
            expect(active.has("presentation")).toBe(true); // forced-on (line 106 branch)
            expect(active.has("tmux")).toBe(false); // forced-off base mode removed (line 107 branch)
        });
    });

    describe("ОС клавиатуры (лестница сигналов)", () => {
        const noTmux = (): Promise<TmuxClientInfo> => Promise.reject(new Error("tmux не должен опрашиваться"));

        it("LC_DIODE_PLATFORM=mac по ssh ⇒ мак, источник env; рунг legacy на простом терминале", () => {
            process.env.SSH_CONNECTION = "1 2 3 4";
            process.env.LC_DIODE_PLATFORM = "mac";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), noTmux);
            expect(service.os).toBe("mac");
            expect(service.osSource).toBe("env");
            expect(service.macKeysRung).toBe("legacy");
        });

        it("LC_TERMINAL=iTerm2 ⇒ мак, источник terminal", () => {
            process.env.LC_TERMINAL = "iTerm2";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), noTmux);
            expect(service.os).toBe("mac");
            expect(service.osSource).toBe("terminal");
        });

        it("настройка keyboard.platform перебивает переменную", () => {
            process.env.LC_DIODE_PLATFORM = "mac";
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                configFrom({ keyboard: { platform: "linux" } }),
                noTmux,
            );
            expect(service.os).toBe("linux");
            expect(service.osSource).toBe("setting");
            expect(service.macKeysRung).toBeUndefined();
        });

        it("без tmux detect() tmux не опрашивает", () => {
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), noTmux);
            service.detect();
            expect(service.os).toBe("linux");
        });

        it("под tmux застывший process.env не читается — живое значение приходит из tmux", async () => {
            process.env.TMUX = "/tmp/x,1,0";
            process.env.LC_DIODE_PLATFORM = "linux"; // застыло на момент создания сессии
            const tmux = vi.fn(() =>
                Promise.resolve<TmuxClientInfo>({ envPlatform: "mac", termType: "kitty(0.45.0)" }),
            );
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), tmux);
            let changed = 0;
            service.onDidChange(() => changed++);
            expect(service.os).toBe("linux");
            expect(service.osSource).toBe("default");

            service.detect();
            service.detect(); // повторный вызов — no-op
            await vi.waitFor(() => {
                expect(service.os).toBe("mac");
            });
            expect(service.osSource).toBe("env");
            expect(tmux).toHaveBeenCalledOnce();
            expect(changed).toBe(1);
        });

        it("под tmux маковский client_termtype переворачивает к маку", async () => {
            process.env.TMUX = "/tmp/x,1,0";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), () =>
                Promise.resolve({ termType: "iTerm2 3.5.0" }),
            );
            service.detect();
            await vi.waitFor(() => {
                expect(service.osSource).toBe("terminal");
            });
            expect(service.os).toBe("mac");
        });

        it("поздний сигнал не перебивает явную настройку и не шумит onDidChange", async () => {
            process.env.TMUX = "/tmp/x,1,0";
            const tmux = vi.fn(() => Promise.resolve<TmuxClientInfo>({ termType: "iTerm2" }));
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                configFrom({ keyboard: { platform: "windows" } }),
                tmux,
            );
            let changed = 0;
            service.onDidChange(() => changed++);
            service.detect();
            await vi.waitFor(() => {
                expect(tmux).toHaveBeenCalled();
            });
            await Promise.resolve();
            expect(service.os).toBe("windows");
            expect(changed).toBe(0);
        });

        it("noteTerminalName: flip только в сторону мака, обратно никогда", () => {
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), noTmux);
            let changed = 0;
            service.onDidChange(() => changed++);
            service.noteTerminalName("kitty(0.45.0)");
            expect(service.os).toBe("linux");
            service.noteTerminalName(undefined);
            expect(changed).toBe(0);
            service.noteTerminalName("Apple_Terminal");
            expect(service.os).toBe("mac");
            expect(changed).toBe(1);
            service.noteTerminalName("WezTerm");
            expect(service.os).toBe("mac"); // незнакомое имя ничего не отменяет
            expect(changed).toBe(1);
        });
    });

    describe("terminalName", () => {
        it("имя от tmux/XTVERSION важнее LC_TERMINAL, а тот — $TERM_PROGRAM", () => {
            process.env.TERM_PROGRAM = "WezTerm";
            const plain = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            expect(plain.terminalName).toBe("WezTerm");
            process.env.LC_TERMINAL = "iTerm2";
            const iterm = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            expect(iterm.terminalName).toBe("iTerm2");
            iterm.noteTerminalName("iTerm2 3.5.0");
            expect(iterm.terminalName).toBe("iTerm2 3.5.0");
        });

        it("поздний сигнал без LC_TERMINAL известный LC_TERMINAL не стирает", () => {
            process.env.LC_TERMINAL = "iTerm2";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            service.noteTerminalName(undefined);
            expect(service.terminalName).toBe("iTerm2");
        });

        it("под tmux $TERM_PROGRAM (это сам tmux) не берётся; пустое значение — «не знаем»", () => {
            process.env.TMUX = "/tmp/x,1,0";
            process.env.TERM_PROGRAM = "tmux";
            expect(
                new TerminalEnvironmentService(new MockTerminalBackend(), configFrom()).terminalName,
            ).toBeUndefined();
            delete process.env.TMUX;
            process.env.TERM_PROGRAM = "";
            expect(
                new TerminalEnvironmentService(new MockTerminalBackend(), configFrom()).terminalName,
            ).toBeUndefined();
        });
    });

    describe("super (Cmd) по увиденному super-биту (noteSuperObserved)", () => {
        it("на маке поднимает рунг до cmd и tier с legacy; повтор — no-op", () => {
            process.env.LC_DIODE_PLATFORM = "mac";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            let changed = 0;
            service.onDidChange(() => changed++);
            expect(service.macKeysRung).toBe("legacy");

            service.noteSuperObserved();
            service.noteSuperObserved();

            expect(service.hasCapability("super")).toBe(true);
            expect(service.hasCapability("extended-keys")).toBe(true);
            expect(service.tier).toBe("csi-u");
            expect(service.macKeysRung).toBe("cmd");
            expect(changed).toBe(1);
        });

        it("не мак на legacy: меняется только tier — событие есть", () => {
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            let changed = 0;
            service.onDidChange(() => changed++);
            service.noteSuperObserved();
            expect(service.tier).toBe("csi-u");
            expect(service.macKeysRung).toBeUndefined();
            expect(changed).toBe(1);
        });

        it("мак на kitty: tier тот же, меняется только рунг — событие есть", () => {
            process.env.TERM = "xterm-kitty";
            process.env.LC_DIODE_PLATFORM = "mac";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            let changed = 0;
            service.onDidChange(() => changed++);
            expect(service.macKeysRung).toBe("extended");
            service.noteSuperObserved();
            expect(service.tier).toBe("kitty");
            expect(service.macKeysRung).toBe("cmd");
            expect(changed).toBe(1);
        });

        it("под tmux рунг остаётся ниже cmd", () => {
            process.env.LC_DIODE_PLATFORM = "mac";
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                configFrom({ terminal: { modes: { tmux: true } } }),
            );
            service.noteSuperObserved();
            expect(service.macKeysRung).toBe("extended");
        });

        it("не мак и tier уже известен — ничего видимого не меняется, событие молчит", () => {
            process.env.TERM = "xterm-kitty";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            let changed = 0;
            service.onDidChange(() => changed++);
            service.noteSuperObserved();
            expect(service.hasCapability("super")).toBe(true);
            expect(changed).toBe(0);
        });

        it("форсированный terminal.capabilities.super=false побеждает наблюдение", () => {
            process.env.LC_DIODE_PLATFORM = "mac";
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                configFrom({ terminal: { capabilities: { super: false } } }),
            );
            service.noteSuperObserved();
            expect(service.hasCapability("super")).toBe(false);
            expect(service.macKeysRung).toBe("extended");
        });

        it("форсированный terminal.capabilities.super=true сразу даёт cmd", () => {
            process.env.LC_DIODE_PLATFORM = "mac";
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                configFrom({ terminal: { capabilities: { super: true } } }),
            );
            expect(service.macKeysRung).toBe("cmd");
        });
    });

    describe("dispose", () => {
        it("clears listeners so later changes notify nobody", () => {
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            let fired = 0;
            service.onDidChange(() => fired++);

            service.dispose();

            service.setMode("presentation", true);
            expect(fired).toBe(0);
        });
    });
});
