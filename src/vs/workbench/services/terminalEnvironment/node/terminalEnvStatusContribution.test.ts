import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
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
        commands.register("workbench.action.openSettingsJson", (...args: unknown[]) => {
            executed.push(args);
        });
        new TerminalEnvStatusContribution(statusBar, env, commands);
        const entry = () => statusBar.entries().find((e) => e.id === "status.terminalEnvironment");
        return {
            env,
            backend,
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
        expect(executed).toEqual([[{ revealSetting: { key: "terminal.tier" } }]]);
    });

    it("auto: a terminal that answers the kitty probe switches the segment to kitty", () => {
        process.env.TERM_PROGRAM = "ghostty";
        const { text, env, backend } = segment();
        env.detect();
        backend.resolveKeyboardProtocol(true);
        expect(text()).toBe("kitty");
    });

    it("legacy: a terminal that answers the kitty probe adds `kitty available` at the end", () => {
        process.env.TERM_PROGRAM = "ghostty";
        const { text, env, backend } = segment({ "terminal.tier": "legacy" });
        env.detect();
        backend.resolveKeyboardProtocol(true);
        expect(text()).toBe("legacy · kitty available");
    });

    it("auto under tmux passing extended keys: `csi-u · tmux`", async () => {
        process.env.TMUX = "/tmp/tmux-1000/default,1,0";
        const { text, env } = segment({}, { extendedKeys: true });
        env.detectTmuxClient();
        await vi.waitFor(() => {
            expect(text()).toBe("csi-u · tmux");
        });
    });

    it("legacy under tmux passing extended keys: `legacy · tmux · csi-u available`", async () => {
        process.env.TMUX = "/tmp/tmux-1000/default,1,0";
        const { text, env } = segment({ "terminal.tier": "legacy" }, { extendedKeys: true });
        env.detectTmuxClient();
        await vi.waitFor(() => {
            expect(text()).toBe("legacy · tmux · csi-u available");
        });
    });

    it("modes are listed sorted, whatever order they were turned on in", () => {
        process.env.TMUX = "/tmp/tmux-1000/default,1,0";
        const { text, env } = segment();
        env.setMode("presentation", true);
        expect(text()).toBe("legacy · presentation,tmux");
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
});
