import { NodeTerminalBackend } from "@tuidom/terminal-backend/nodeTerminalBackend";
import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigurationModel } from "../../../../platform/configuration/common/configurationModel.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { ConfigurationService } from "../../../../platform/configuration/node/configurationService.ts";
import { terminalConfiguration } from "../../../common/configuration/terminalConfiguration.ts";

import { extendedKeysAtStartup, extendedKeysSwitch, TerminalEnvironmentService } from "./terminalEnvironmentService.ts";
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
        delete process.env.TMUX;
        delete process.env.SSH_CONNECTION;
        delete process.env.SSH_TTY;
        delete process.env.COLORTERM;
        delete process.env.TERM_PROGRAM;
        delete process.env.LC_DIODE_PLATFORM;
        delete process.env.LC_TERMINAL;
        process.env.TERM = "xterm-256color";
    });

    afterEach(() => {
        process.env = savedEnv;
    });

    function create(settings: Record<string, unknown> = {}, tmux: TmuxClientInfo = {}) {
        const backend = new MockTerminalBackend();
        const enabled: string[] = [];
        const service = new TerminalEnvironmentService(
            backend,
            configFrom(settings),
            () => Promise.resolve(tmux),
            () => enabled.push("enable"),
        );
        let changed = 0;
        service.onDidChange(() => changed++);
        return { backend, service, enabled, changed: () => changed };
    }

    describe("the tier is fixed at startup (#1049)", () => {
        it("auto stays legacy even in kitty: env hints do not turn anything on", () => {
            process.env.TERM = "xterm-kitty";
            process.env.KITTY_WINDOW_ID = "1";
            const { service } = create();
            expect(service.tier).toBe("legacy");
            expect(service.hasCapability("extended-keys")).toBe(false);
        });

        it("auto: a probe answer only reports kitty as available, the tier stays legacy", () => {
            const { backend, service, enabled, changed } = create();
            service.detect();
            backend.resolveKeyboardProtocol(true);

            expect(service.tier).toBe("legacy");
            expect(service.hasCapability("extended-keys")).toBe(false);
            expect(service.availableTier).toBe("kitty");
            expect(enabled).toEqual([]);
            expect(changed()).toBe(1);
        });

        it("no probe answer: nothing available, no event", () => {
            const { backend, service, changed } = create();
            service.detect();
            backend.resolveKeyboardProtocol(false);

            expect(service.availableTier).toBeUndefined();
            expect(changed()).toBe(0);
        });

        it.each(["csi-u", "kitty"] as const)("terminal.tier %s: that tier with extended keys on", (tier) => {
            const { service } = create({ terminal: { tier } });
            expect(service.tier).toBe(tier);
            expect(service.hasCapability("extended-keys")).toBe(true);
            expect(extendedKeysAtStartup(configFrom({ terminal: { tier } }))).toBe(true);
        });

        it("an explicit tier: a probe answer offers nothing more and does not switch", () => {
            const { backend, service, enabled } = create({ terminal: { tier: "csi-u" } });
            service.detect();
            backend.resolveKeyboardProtocol(true);
            expect(service.tier).toBe("csi-u");
            expect(service.availableTier).toBeUndefined();
            expect(enabled).toEqual([]);
        });

        it("auto + terminal.capabilities extended-keys: true turns the protocols on", () => {
            process.env.TERM = "xterm-kitty";
            const settings = { terminal: { capabilities: { "extended-keys": true } } };
            const { service } = create(settings);
            expect(service.tier).toBe("kitty");
            expect(extendedKeysAtStartup(configFrom(settings))).toBe(true);
        });

        it.each<[Record<string, unknown>]>([
            [{}],
            [{ terminal: { tier: "legacy" } }],
            [{ terminal: { tier: "legacy", capabilities: { "extended-keys": true } } }],
            [{ terminal: { capabilities: { "extended-keys": false } } }],
            [{ terminal: { capabilities: { "extended-keys": "yes" } } }],
        ])("%j keeps the protocols off and the tier legacy", (settings) => {
            expect(extendedKeysAtStartup(configFrom(settings))).toBe(false);
            const { service } = create(settings);
            expect(service.tier).toBe("legacy");
            expect(service.hasCapability("extended-keys")).toBe(false);
        });
    });

    describe("availability under tmux", () => {
        beforeEach(() => {
            process.env.TMUX = "/tmp/tmux-1000/default,1,0";
        });

        it("tmux passing extended keys offers csi-u; the tier stays legacy", async () => {
            const { service } = create({}, { extendedKeys: true });
            service.detectTmuxClient();
            await vi.waitFor(() => {
                expect(service.availableTier).toBe("csi-u");
            });
            expect(service.tier).toBe("legacy");
        });

        it.each<[string, Record<string, unknown>, boolean]>([
            ["tmux without extended keys", {}, false],
            ["an explicit tier", { terminal: { tier: "csi-u" } }, true],
        ])("%s: nothing is offered", async (_name, settings, extendedKeys) => {
            const { service } = create(settings, { extendedKeys, termType: "kitty(0.45.0)" });
            service.detectTmuxClient();
            await vi.waitFor(() => {
                expect(service.terminalName).toBe("kitty(0.45.0)");
            });
            expect(service.availableTier).toBeUndefined();
        });
    });

    describe("the Mac exception: kitty on after the probe, outside tmux", () => {
        it("auto + mac keyboard + a probe answer: kitty on once, tier kitty, rung cmd", () => {
            process.env.TERM_PROGRAM = "ghostty";
            const { backend, service, enabled, changed } = create({ keyboard: { platform: "mac" } });
            expect(service.macKeysRung).toBe("legacy");

            service.detect();
            backend.resolveKeyboardProtocol(true);

            expect(enabled).toEqual(["enable"]);
            expect(service.tier).toBe("kitty");
            expect(service.macKeysRung).toBe("cmd");
            expect(service.hasCapability("super")).toBe(true);
            expect(service.availableTier).toBeUndefined();
            expect(changed()).toBe(1);
        });

        it("the tier follows resolveTier: csi-u without a kitty-graphics hint", () => {
            const { backend, service } = create({ keyboard: { platform: "mac" } });
            service.detect();
            backend.resolveKeyboardProtocol(true);
            expect(service.tier).toBe("csi-u");
            expect(service.macKeysRung).toBe("cmd");
        });

        it("a Mac terminal name from XTVERSION (answered first) is enough", () => {
            const { backend, service, enabled } = create();
            backend.terminalVersion = "iTerm2 3.5.0";
            service.detect();
            backend.resolveKeyboardProtocol(true);
            expect(enabled).toEqual(["enable"]);
            expect(service.macKeysRung).toBe("cmd");
        });

        it("no probe answer: legacy and mac-legacy for the session", () => {
            const { backend, service, enabled } = create({ keyboard: { platform: "mac" } });
            service.detect();
            backend.resolveKeyboardProtocol(false);
            expect(enabled).toEqual([]);
            expect(service.tier).toBe("legacy");
            expect(service.macKeysRung).toBe("legacy");
        });

        it("under tmux: legacy, nothing is switched", () => {
            process.env.TMUX = "/tmp/tmux-1000/default,1,0";
            const { backend, service, enabled } = create({ keyboard: { platform: "mac" } });
            service.detect();
            backend.resolveKeyboardProtocol(true);
            expect(enabled).toEqual([]);
            expect(service.tier).toBe("legacy");
            expect(service.macKeysRung).toBe("legacy");
        });

        it.each<[Record<string, unknown>]>([[{ tier: "legacy" }], [{ capabilities: { "extended-keys": false } }]])(
            "explicit %j: no exception",
            (terminal) => {
                const { backend, service, enabled } = create({ keyboard: { platform: "mac" }, terminal });
                service.detect();
                backend.resolveKeyboardProtocol(true);
                expect(enabled).toEqual([]);
                expect(service.macKeysRung).toBe("legacy");
            },
        );

        it("a forced super: false keeps the rung at extended", () => {
            const { backend, service } = create({
                keyboard: { platform: "mac" },
                terminal: { capabilities: { super: false } },
            });
            service.detect();
            backend.resolveKeyboardProtocol(true);
            expect(service.tier).toBe("csi-u");
            expect(service.macKeysRung).toBe("extended");
        });

        it("an explicit tier on a mac: the probe answer proves Cmd, nothing is switched", () => {
            const { backend, service, enabled } = create({
                keyboard: { platform: "mac" },
                terminal: { tier: "kitty" },
            });
            expect(service.macKeysRung).toBe("extended");
            service.detect();
            backend.resolveKeyboardProtocol(true);
            expect(enabled).toEqual([]);
            expect(service.tier).toBe("kitty");
            expect(service.macKeysRung).toBe("cmd");
        });

        it("not a mac: no exception", () => {
            const { backend, service, enabled } = create({ keyboard: { platform: "linux" } });
            service.detect();
            backend.resolveKeyboardProtocol(true);
            expect(enabled).toEqual([]);
            expect(service.availableTier).toBe("kitty");
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

            service.setMode("presentation", true);
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
            process.env.TMUX = "/tmp/x,1,0";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());

            service.setMode("presentation", true);
            service.setMode("tmux", false);

            const active = service.getActiveModes();
            expect(active.has("local")).toBe(true);
            expect(active.has("presentation")).toBe(true);
            expect(active.has("tmux")).toBe(false);
        });
    });

    describe("keyboard OS (signal ladder)", () => {
        const noTmux = (): Promise<TmuxClientInfo> => Promise.reject(new Error("tmux must not be queried"));

        it("LC_DIODE_PLATFORM=mac over ssh ⇒ mac, source env; legacy rung on a plain terminal", () => {
            process.env.SSH_CONNECTION = "1 2 3 4";
            process.env.LC_DIODE_PLATFORM = "mac";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), noTmux);
            expect(service.os).toBe("mac");
            expect(service.osSource).toBe("env");
            expect(service.macKeysRung).toBe("legacy");
        });

        it("LC_TERMINAL=iTerm2 ⇒ mac, source terminal", () => {
            process.env.LC_TERMINAL = "iTerm2";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), noTmux);
            expect(service.os).toBe("mac");
            expect(service.osSource).toBe("terminal");
        });

        it("the keyboard.platform setting overrides the variable", () => {
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

        it("without tmux neither detect() nor detectTmuxClient() query tmux", () => {
            const tmux = vi.fn(noTmux);
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), tmux);
            service.detect();
            service.detectTmuxClient();
            expect(service.os).toBe("linux");
            expect(tmux).not.toHaveBeenCalled();
        });

        it("under tmux detect() does not spawn tmux: that is detectTmuxClient(), after the first frame", () => {
            process.env.TMUX = "/tmp/x,1,0";
            const tmux = vi.fn(() => Promise.resolve<TmuxClientInfo>({}));
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), tmux);
            service.detect();
            expect(tmux).not.toHaveBeenCalled();
            service.detectTmuxClient();
            expect(tmux).toHaveBeenCalledOnce();
        });

        it("under tmux the frozen process.env is not read: the live value comes from tmux", async () => {
            process.env.TMUX = "/tmp/x,1,0";
            process.env.LC_DIODE_PLATFORM = "linux"; // frozen at session creation
            const tmux = vi.fn(() =>
                Promise.resolve<TmuxClientInfo>({ envPlatform: "mac", termType: "kitty(0.45.0)" }),
            );
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), tmux);
            let changed = 0;
            service.onDidChange(() => changed++);
            expect(service.os).toBe("linux");
            expect(service.osSource).toBe("default");

            service.detectTmuxClient();
            service.detectTmuxClient(); // a repeated call is a no-op
            await vi.waitFor(() => {
                expect(service.os).toBe("mac");
            });
            expect(service.osSource).toBe("env");
            expect(tmux).toHaveBeenCalledOnce();
            expect(changed).toBe(1);
        });

        it("under tmux a mac client_termtype flips to mac", async () => {
            process.env.TMUX = "/tmp/x,1,0";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), () =>
                Promise.resolve({ termType: "iTerm2 3.5.0" }),
            );
            service.detectTmuxClient();
            await vi.waitFor(() => {
                expect(service.osSource).toBe("terminal");
            });
            expect(service.os).toBe("mac");
        });

        it("a late signal does not override an explicit setting and does not spam onDidChange", async () => {
            process.env.TMUX = "/tmp/x,1,0";
            const tmux = vi.fn(() => Promise.resolve<TmuxClientInfo>({ termType: "iTerm2" }));
            const service = new TerminalEnvironmentService(
                new MockTerminalBackend(),
                configFrom({ keyboard: { platform: "windows" } }),
                tmux,
            );
            let changed = 0;
            service.onDidChange(() => changed++);
            service.detectTmuxClient();
            await vi.waitFor(() => {
                expect(tmux).toHaveBeenCalled();
            });
            await Promise.resolve();
            expect(service.os).toBe("windows");
            expect(changed).toBe(0);
        });

        it("without tmux the terminal name comes from the XTVERSION probe and flips to mac", () => {
            const backend = new MockTerminalBackend();
            backend.terminalVersion = "iTerm2 3.5.0";
            const service = new TerminalEnvironmentService(backend, configFrom(), noTmux);
            let changed = 0;
            service.onDidChange(() => changed++);
            service.detect();
            expect(service.terminalName).toBe("iTerm2 3.5.0");
            expect(service.os).toBe("mac");
            expect(service.osSource).toBe("terminal");
            expect(changed).toBe(1);
        });

        it("XTVERSION without a reply means `unknown`, nothing changes", () => {
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom(), noTmux);
            service.detect();
            expect(service.terminalName).toBeUndefined();
            expect(service.os).toBe("linux");
        });

        it("under tmux XTVERSION is not sent: tmux itself would reply, not the outer terminal", async () => {
            process.env.TMUX = "/tmp/x,1,0";
            const backend = new MockTerminalBackend();
            backend.terminalVersion = "tmux 3.4";
            const service = new TerminalEnvironmentService(backend, configFrom(), () =>
                Promise.resolve<TmuxClientInfo>({ termType: "kitty(0.45.0)" }),
            );
            service.detect();
            // The "tmux 3.4" reply must not become the outer terminal's name.
            expect(service.terminalName).toBeUndefined();
            service.detectTmuxClient();
            await vi.waitFor(() => {
                expect(service.terminalName).toBe("kitty(0.45.0)");
            });
        });

        it("noteTerminalName: flips only toward mac, never back", () => {
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
            expect(service.os).toBe("mac"); // an unknown name cancels nothing
            expect(changed).toBe(1);
        });
    });

    describe("terminalName", () => {
        it("the name from tmux/XTVERSION outranks LC_TERMINAL, which outranks $TERM_PROGRAM", () => {
            process.env.TERM_PROGRAM = "WezTerm";
            const plain = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            expect(plain.terminalName).toBe("WezTerm");
            process.env.LC_TERMINAL = "iTerm2";
            const iterm = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            expect(iterm.terminalName).toBe("iTerm2");
            iterm.noteTerminalName("iTerm2 3.5.0");
            expect(iterm.terminalName).toBe("iTerm2 3.5.0");
        });

        it("a late signal without LC_TERMINAL does not erase a known LC_TERMINAL", () => {
            process.env.LC_TERMINAL = "iTerm2";
            const service = new TerminalEnvironmentService(new MockTerminalBackend(), configFrom());
            service.noteTerminalName(undefined);
            expect(service.terminalName).toBe("iTerm2");
        });

        it("under tmux $TERM_PROGRAM (tmux itself) is not taken; an empty value means `unknown`", () => {
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

    describe("super (Cmd) forced by config", () => {
        it("a forced terminal.capabilities.super=true gives cmd immediately", () => {
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

describe("extendedKeysSwitch", () => {
    it("turns the protocols on in a real terminal backend", () => {
        const writes: string[] = [];
        const stdout = {
            write(data: string): boolean {
                writes.push(data);
                return true;
            },
        } as unknown as NodeJS.WriteStream;
        const backend = new NodeTerminalBackend(process.stdin, stdout, { extendedKeys: false });

        extendedKeysSwitch(backend)();

        expect(writes.join("")).toContain("\x1b[>15u");
    });

    it("has nothing to switch on a backend without a terminal", () => {
        expect(() => {
            extendedKeysSwitch(new MockTerminalBackend())();
        }).not.toThrow();
    });
});
