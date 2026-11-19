import { describe, expect, it } from "vitest";

import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import type { ITerminalSessionOptions } from "../common/terminalSessionFactory.ts";

import { TerminalService } from "./terminalService.ts";

function buildHarness(settings: Record<string, unknown> = {}) {
    const views = makeViewsHarness();
    const configuration = createTestConfigurationService(settings);
    const sessions: FakeTerminalSurface[] = [];
    const factoryCalls: ITerminalSessionOptions[] = [];
    const service = new TerminalService(views.service, configuration, (options) => {
        factoryCalls.push(options);
        const surface = new FakeTerminalSurface(options.shell ?? "/bin/bash", 100);
        sessions.push(surface);
        return surface;
    });
    return { service, configuration, sessions, factoryCalls };
}

describe("TerminalService — shell integration options of the session", () => {
    it("`terminal.integrated.shellIntegration.enabled` (default on) goes to the session; a task terminal is marked", () => {
        const h = buildHarness();
        h.service.createInstance({ cwd: "/ws" });
        h.service.createInstance({ cwd: "/ws", isFeatureTerminal: true });
        h.service.createInstance({ cwd: "/ws", isFeatureTerminal: false });
        expect(h.factoryCalls).toStrictEqual([
            { cols: 80, rows: 24, cwd: "/ws", shellIntegrationEnabled: true },
            { cols: 80, rows: 24, cwd: "/ws", shellIntegrationEnabled: true, isFeatureTerminal: true },
            { cols: 80, rows: 24, cwd: "/ws", shellIntegrationEnabled: true },
        ]);
        h.service.dispose();
    });

    it("read at every (re)launch: off in the settings — the relaunched process is not injected", async () => {
        const h = buildHarness({ "terminal.integrated.shellIntegration.enabled": false });
        const instance = h.service.createInstance({ cwd: "/ws", waitOnExit: true });
        expect(h.factoryCalls[0]?.shellIntegrationEnabled).toBe(false);
        await h.configuration.updateValue("terminal.integrated.shellIntegration.enabled", true);
        h.sessions[0].emitExit(0);
        h.service.relaunchInstance(instance.id, { cwd: "/ws", isFeatureTerminal: true });
        expect(h.sessions[0].relaunches).toStrictEqual([
            { cwd: "/ws", shellIntegrationEnabled: true, isFeatureTerminal: true },
        ]);
        h.service.dispose();
    });
});
