import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MockTerminalBackend } from "../../../../../../tuidom/backend/mockTerminalBackend.ts";
import { createAppTestHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { registerContextKeys } from "../../../../platform/contextkey/common/contextKeys.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { statusSegments } from "../../../browser/parts/statusbar/statusBarComponent.testUtils.ts";
import { StatusBarComponentDIToken } from "../../../browser/parts/statusbar/statusBarComponent.ts";
import { TerminalBackendDIToken } from "../../../common/coreTokens.ts";

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

    // activate() pushes the synchronously-detected env into context keys and starts the probe.
    async function setup() {
        const h = createAppTestHarness(); // WorkbenchComponent subscribes to env changes
        await h.workbench.activate();
        const contextKeys = h.container.get(ContextKeyServiceDIToken);
        const statusBar = h.container.get(StatusBarComponentDIToken);
        const env = h.container.get(TerminalEnvironmentServiceDIToken);
        const backend = h.container.get(TerminalBackendDIToken) as MockTerminalBackend;
        return { workbench: h.workbench, contextKeys, statusBar, env, backend };
    }

    it("flows a synchronously-detected kitty tier into context keys and the status bar", async () => {
        process.env.TERM = "xterm-kitty"; // extended-keys + graphics hint → kitty (no probe needed)
        const { contextKeys, statusBar } = await setup();

        expect(contextKeys.evaluate("tier == 'kitty'")).toBe(true);
        expect(contextKeys.evaluate("cap_extendedKeys")).toBe(true);
        expect(statusSegments(statusBar.view)[0]).toEqual({ text: "kitty", side: "left" });
    });

    it("upgrades the tier (and re-renders) when the fire-and-forget probe confirms support", async () => {
        process.env.TERM = "xterm-256color"; // env says legacy
        const { contextKeys, statusBar, backend } = await setup();

        expect(contextKeys.evaluate("tier == 'legacy'")).toBe(true);
        expect(statusSegments(statusBar.view)[0]).toEqual({ text: "legacy", side: "left" });

        // activate() already started the probe; the terminal now confirms keyboard-protocol support.
        backend.resolveKeyboardProtocol(true);

        expect(contextKeys.evaluate("tier == 'legacy'")).toBe(false);
        expect(contextKeys.evaluate("cap_extendedKeys")).toBe(true);
        expect(statusSegments(statusBar.view)[0]).toEqual({ text: "csi-u", side: "left" });
    });

    it("reflects a runtime mode toggle in context keys and the status bar", async () => {
        const { contextKeys, statusBar, env } = await setup();

        expect(contextKeys.evaluate("mode_ssh")).toBe(false);
        env.setMode("ssh", true);

        expect(contextKeys.evaluate("mode_ssh")).toBe(true);
        expect(statusSegments(statusBar.view)[0]).toEqual({ text: "legacy · ssh", side: "left" });
    });

    it("custom-mode identifiers are valid in when-expressions once registered", async () => {
        registerContextKeys(["mode_presentation"]);
        const { contextKeys } = await setup();
        // Unknown-but-registered key evaluates to false without throwing.
        expect(contextKeys.evaluate("mode_presentation")).toBe(false);
        contextKeys.setRaw("mode_presentation", true);
        expect(contextKeys.evaluate("mode_presentation")).toBe(true);
    });
});
