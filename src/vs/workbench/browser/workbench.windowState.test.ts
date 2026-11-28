import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { ProgressServiceDIToken } from "../../platform/progress/common/progressService.ts";
import { TerminalBackendDIToken } from "../../platform/terminal/common/terminalBackendDIToken.ts";
import { HostServiceDIToken } from "../services/host/browser/hostService.ts";
import { CHECK_INTERVAL } from "../services/userActivity/browser/domActivityTracker.ts";
import {
    MARK_INACTIVE_DEBOUNCE,
    PROGRESS_ACTIVITY_HOLD,
    UserActivityServiceDIToken,
} from "../services/userActivity/common/userActivityService.ts";

import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";

const WALK_AWAY = CHECK_INTERVAL * 3 + MARK_INACTIVE_DEBOUNCE;

function createApp() {
    const { container, bindApp } = createTestContainer();
    const workbench = container.get(WorkbenchComponentDIToken);
    workbench.mount();
    const testApp = TestApp.create(workbench.view, new Size(80, 24));
    bindApp(testApp.app);
    testApp.render();
    return {
        testApp,
        terminal: container.get(TerminalBackendDIToken) as MockTerminalBackend,
        container,
        userActivity: container.get(UserActivityServiceDIToken),
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("Workbench — window state sources", () => {
    it("the focus service listens from startup: a report before anyone asked for it still counts", () => {
        const { terminal, container } = createApp();
        terminal.sendFocus(false);
        expect(container.get(HostServiceDIToken).hasFocus).toBe(false);
    });

    it("keys on the root count as activity; a minute and a half of silence does not", () => {
        vi.useFakeTimers();
        const { testApp, userActivity } = createApp();
        vi.advanceTimersByTime(WALK_AWAY);
        expect(userActivity.isActive).toBe(false);
        testApp.sendKey("Escape");
        expect(userActivity.isActive).toBe(true);
    });

    it("a long host progress extends the activity", async () => {
        vi.useFakeTimers();
        const { container, userActivity } = createApp();
        let finish!: () => void;
        const running = container
            .get(ProgressServiceDIToken)
            .withProgress({ location: "window", title: "Long" }, () => new Promise<void>((r) => (finish = r)));
        vi.advanceTimersByTime((PROGRESS_ACTIVITY_HOLD.whenHeldFor ?? 0) + WALK_AWAY);
        expect(userActivity.isActive).toBe(true);
        finish();
        await running;
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE);
        expect(userActivity.isActive).toBe(false);
    });
});
