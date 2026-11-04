import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { TerminalBackendDIToken } from "../../../../platform/terminal/common/terminalBackendDIToken.ts";
import { statusSegments } from "../../../browser/parts/statusbar/statusBarComponent.testUtils.ts";
import { StatusBarComponentDIToken } from "../../../browser/parts/statusbar/statusBarComponent.ts";

import { TerminalEnvironmentServiceDIToken } from "./terminalEnvironmentService.ts";

describe("Terminal environment integration (context keys + status bar)", () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        delete process.env.TMUX;
        delete process.env.SSH_CONNECTION;
        delete process.env.SSH_TTY;
        delete process.env.KITTY_WINDOW_ID;
        process.env.TERM = "xterm-256color";
    });

    afterEach(() => {
        process.env = savedEnv;
    });

    async function setup(settings: Record<string, unknown> = {}) {
        // WorkbenchComponent subscribes to env changes
        const h = createAppTestHarness({ configurationService: createTestConfigurationService(settings) });
        await h.workbench.activate();
        const contextKeys = h.container.get(ContextKeyServiceDIToken);
        const statusBar = h.container.get(StatusBarComponentDIToken);
        const env = h.container.get(TerminalEnvironmentServiceDIToken);
        const backend = h.container.get(TerminalBackendDIToken) as MockTerminalBackend;
        return { workbench: h.workbench, contextKeys, statusBar, env, backend };
    }

    it("an explicit terminal.tier flows into context keys and the status bar", async () => {
        process.env.TERM = "xterm-kitty";
        const { contextKeys, statusBar } = await setup({ "terminal.tier": "kitty" });

        expect(contextKeys.evaluate("tier == 'kitty'")).toBe(true);
        expect(contextKeys.evaluate("cap_extendedKeys")).toBe(true);
        expect(statusSegments(statusBar.view)[0]).toEqual({ text: "kitty", side: "left" });
    });

    it("auto in kitty stays legacy; the probe answer only adds `kitty available`", async () => {
        process.env.TERM = "xterm-kitty";
        const { contextKeys, statusBar, backend } = await setup();

        expect(contextKeys.evaluate("tier == 'legacy'")).toBe(true);
        expect(statusSegments(statusBar.view)[0]).toEqual({ text: "legacy", side: "left" });

        // activate() already started the probe; the terminal now confirms keyboard-protocol support.
        backend.resolveKeyboardProtocol(true);

        expect(contextKeys.evaluate("tier == 'legacy'")).toBe(true);
        expect(contextKeys.evaluate("cap_extendedKeys")).toBe(false);
        expect(statusSegments(statusBar.view)[0]).toEqual({ text: "legacy · kitty available", side: "left" });
    });

    it("reflects a runtime mode toggle in context keys and the status bar", async () => {
        const { contextKeys, statusBar, env } = await setup();

        expect(contextKeys.evaluate("mode_ssh")).toBe(false);
        env.setMode("ssh", true);

        expect(contextKeys.evaluate("mode_ssh")).toBe(true);
        expect(statusSegments(statusBar.view)[0]).toEqual({ text: "legacy · ssh", side: "left" });
    });

    it("custom-mode identifiers are valid in when-expressions without registration", async () => {
        const { contextKeys } = await setup();
        expect(contextKeys.evaluate("mode_presentation")).toBe(false);
        contextKeys.setRaw("mode_presentation", true);
        expect(contextKeys.evaluate("mode_presentation")).toBe(true);
    });
});
