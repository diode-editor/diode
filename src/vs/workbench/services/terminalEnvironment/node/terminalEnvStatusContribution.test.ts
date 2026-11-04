import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { NotificationService } from "../../notification/browser/notificationService.ts";
import { StatusBarService } from "../../statusbar/common/statusBarService.ts";

import { TerminalEnvironmentService } from "./terminalEnvironmentService.ts";
import { TerminalEnvStatusContribution } from "./terminalEnvStatusContribution.ts";
import type { TmuxClientInfo } from "./tmuxClientProbe.ts";

describe("TerminalEnvStatusContribution", () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        delete process.env.TMUX;
        delete process.env.SSH_CONNECTION;
        delete process.env.SSH_TTY;
        delete process.env.LC_TERMINAL;
        delete process.env.TERM_PROGRAM;
        process.env.TERM = "xterm-256color";
    });

    afterEach(() => {
        process.env = savedEnv;
    });

    function segment(settings: Record<string, unknown> = {}, tmux: TmuxClientInfo = {}) {
        const statusBar = new StatusBarService(NULL_STATE_SERVICE);
        const backend = new MockTerminalBackend();
        const configuration = createTestConfigurationService(settings);
        const env = new TerminalEnvironmentService(backend, configuration, () => Promise.resolve(tmux));
        const commands = new CommandRegistry();
        const executed: unknown[][] = [];
        for (const id of ["workbench.action.openSettingsJson", "workbench.action.reloadWindow"]) {
            commands.register(id, (...args: unknown[]) => {
                executed.push([id, ...args]);
            });
        }
        const notifications = new NotificationService();
        new TerminalEnvStatusContribution(statusBar, env, commands, configuration, notifications);
        const entry = () => statusBar.entries().find((e) => e.id === "status.terminalEnvironment");
        return {
            env,
            backend,
            configuration,
            notifications,
            executed,
            click: () => entry()?.onClick?.(),
            text: () => entry()?.text ?? "",
        };
    }

    it("pc: only tier and modes; a click opens settings.json at terminal.tier", () => {
        delete process.env.LC_DIODE_PLATFORM;
        const { text, click, executed } = segment();
        expect(text()).toBe("legacy");
        click();
        expect(executed).toEqual([["workbench.action.openSettingsJson", { revealSetting: { key: "terminal.tier" } }]]);
    });

    it("a terminal that answers the kitty probe adds `kitty available` at the end", () => {
        process.env.TERM_PROGRAM = "ghostty";
        const { text, env, backend } = segment();
        env.detect();
        backend.resolveKeyboardProtocol(true);
        expect(text()).toBe("legacy · kitty available");
    });

    it("under tmux passing extended keys: `legacy · tmux · csi-u available`", async () => {
        process.env.TMUX = "/tmp/tmux-1000/default,1,0";
        const { text, env } = segment({}, { extendedKeys: true });
        env.detectTmuxClient();
        await vi.waitFor(() => {
            expect(text()).toBe("legacy · tmux · csi-u available");
        });
    });

    it("an explicit tier shows as is, with nothing available", () => {
        const { text, env, backend } = segment({ "terminal.tier": "csi-u" });
        env.detect();
        backend.resolveKeyboardProtocol(true);
        expect(text()).toBe("csi-u");
    });

    it("mac: the rung next to the tier; the probe answer turns kitty on, no `available`", () => {
        process.env.LC_DIODE_PLATFORM = "mac";
        process.env.TERM_PROGRAM = "ghostty";
        const { text, env, backend } = segment();
        expect(text()).toBe("legacy · mac-legacy");
        env.detect();
        backend.resolveKeyboardProtocol(true);
        expect(text()).toBe("kitty · mac-cmd");
        env.setMode("tmux", true);
        expect(text()).toBe("kitty · mac-extended · tmux");
    });

    it.each(["terminal.tier", "terminal.capabilities"])(
        "changing %s in a live session asks for a restart and keeps the tier",
        async (key) => {
            const { env, configuration, notifications, executed } = segment();
            await configuration.updateValue(key, key === "terminal.tier" ? "kitty" : { "extended-keys": true });
            const shown = notifications.current();
            expect(shown?.message).toBe(`Restart Diode to apply ${key}`);
            expect(env.tier).toBe("legacy");

            notifications.answer(shown?.id ?? -1, 0);
            await vi.waitFor(() => {
                expect(executed).toEqual([["workbench.action.reloadWindow"]]);
            });
        },
    );

    it("other settings do not ask for a restart", async () => {
        const { configuration, notifications } = segment();
        await configuration.updateValue("keyboard.platform", "mac");
        expect(notifications.isEmpty()).toBe(true);
    });
});
