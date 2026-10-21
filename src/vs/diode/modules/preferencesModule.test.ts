import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { TerminalEnvironmentService } from "../../workbench/services/terminalEnvironment/node/terminalEnvironmentService.ts";

import { keyboardDoctorSnapshot } from "./preferencesModule.ts";

describe("keyboardDoctorSnapshot", () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        delete process.env.SSH_CONNECTION;
        delete process.env.SSH_TTY;
        delete process.env.LC_TERMINAL;
        delete process.env.KITTY_WINDOW_ID;
        delete process.env.COLORTERM;
        process.env.TMUX = "/tmp/x,1,0";
        process.env.TERM = "xterm-kitty";
        process.env.TERM_PROGRAM = "tmux";
        process.env.LC_DIODE_PLATFORM = "mac";
    });

    afterEach(() => {
        process.env = savedEnv;
    });

    it("environment snapshot for doctor: OS with source, rung, enabled caps and sorted modes", () => {
        const env = new TerminalEnvironmentService(new MockTerminalBackend(), createTestConfigurationService());
        env.noteTerminalName("kitty(0.45.0)");
        env.setMode("presentation", true); // inserted last — the snapshot sorts
        expect(keyboardDoctorSnapshot(env)).toEqual({
            os: "linux", // under tmux our own LC_DIODE_PLATFORM is not read — only tmux's
            osSource: "default",
            tier: "kitty",
            macKeysRung: undefined,
            capabilities: ["extended-keys", "kitty-graphics", "mouse-sgr"],
            modes: ["local", "presentation", "tmux"],
            terminalName: "kitty(0.45.0)",
            term: "xterm-kitty",
        });
    });
});
