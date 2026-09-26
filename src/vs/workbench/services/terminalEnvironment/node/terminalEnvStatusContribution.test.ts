import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../statusbar/common/statusBarService.ts";

import { TerminalEnvironmentService } from "./terminalEnvironmentService.ts";
import { TerminalEnvStatusContribution } from "./terminalEnvStatusContribution.ts";

describe("TerminalEnvStatusContribution", () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        delete process.env.TMUX;
        delete process.env.SSH_CONNECTION;
        delete process.env.SSH_TTY;
        delete process.env.LC_TERMINAL;
        delete process.env.KITTY_WINDOW_ID;
        delete process.env.TERM_PROGRAM;
        process.env.TERM = "xterm-256color";
    });

    afterEach(() => {
        process.env = savedEnv;
    });

    function segment() {
        const statusBar = new StatusBarService(NULL_STATE_SERVICE);
        const env = new TerminalEnvironmentService(new MockTerminalBackend(), NULL_CONFIGURATION_SERVICE);
        const commands = new CommandRegistry();
        const executed: string[] = [];
        commands.register("diode.keyboardDoctor", () => {
            executed.push("diode.keyboardDoctor");
        });
        new TerminalEnvStatusContribution(statusBar, env, commands);
        const entry = () => statusBar.entries().find((e) => e.id === "status.terminalEnvironment");
        return { env, executed, click: () => entry()?.onClick?.(), text: () => entry()?.text ?? "" };
    }

    it("pc: только tier и моды; клик открывает Keyboard Doctor", () => {
        delete process.env.LC_DIODE_PLATFORM;
        const { text, click, executed } = segment();
        expect(text()).toBe("legacy");
        click();
        expect(executed).toEqual(["diode.keyboardDoctor"]);
    });

    it("мак: рунг мак-лестницы рядом с tier и обновляется по onDidChange", () => {
        process.env.LC_DIODE_PLATFORM = "mac";
        const { text, env } = segment();
        expect(text()).toBe("legacy · mac-legacy");
        env.noteSuperObserved();
        expect(text()).toBe("csi-u · mac-cmd");
        env.setMode("tmux", true);
        expect(text()).toBe("csi-u · mac-extended · tmux");
    });
});
