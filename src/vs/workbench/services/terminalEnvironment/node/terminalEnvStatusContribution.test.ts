import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../statusbar/common/statusBarService.ts";

import { TerminalEnvironmentService } from "./terminalEnvironmentService.ts";
import { TerminalEnvStatusContribution } from "./terminalEnvStatusContribution.ts";

describe("TerminalEnvStatusContribution", () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        for (const name of ["TMUX", "SSH_CONNECTION", "SSH_TTY", "LC_TERMINAL", "KITTY_WINDOW_ID", "TERM_PROGRAM"]) {
            delete process.env[name];
        }
        process.env.TERM = "xterm-256color";
    });

    afterEach(() => {
        process.env = savedEnv;
    });

    function segment(): { text: () => string; env: TerminalEnvironmentService } {
        const statusBar = new StatusBarService(NULL_STATE_SERVICE);
        const env = new TerminalEnvironmentService(new MockTerminalBackend(), NULL_CONFIGURATION_SERVICE);
        new TerminalEnvStatusContribution(statusBar, env);
        return {
            env,
            text: () => statusBar.entries().find((entry) => entry.id === "status.terminalEnvironment")?.text ?? "",
        };
    }

    it("pc: только tier и моды", () => {
        delete process.env.LC_DIODE_PLATFORM;
        const { text } = segment();
        expect(text()).toBe("legacy");
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
