import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { ConfigurationModel } from "../../../../platform/configuration/common/configurationModel.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { ConfigurationService } from "../../../../platform/configuration/node/configurationService.ts";
import { terminalConfiguration } from "../../../common/configuration/terminalConfiguration.ts";

import { TerminalEnvironmentService } from "./terminalEnvironmentService.ts";

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
