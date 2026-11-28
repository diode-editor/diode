import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { UserActivityServiceDIToken } from "../services/userActivity/common/userActivityService.ts";

import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";

// `window.state.active` as the user produces it: terminal input (raw keys and focus reports, mouse tokens) through the
// whole input path, on fake timers. Upstream: inactive after 60–90 s without keydown/mousedown plus a 10 s debounce.

function createApp() {
    const { container, bindApp } = createTestContainer();
    const workbench = container.get(WorkbenchComponentDIToken);
    workbench.mount();
    const testApp = TestApp.create(workbench.view, new Size(80, 24));
    bindApp(testApp.app);
    testApp.render();
    return { testApp, userActivity: container.get(UserActivityServiceDIToken) };
}

const WALK_AWAY = 100_000;

function mouse(testApp: TestApp, action: "press" | "release" | "scroll-up", button: "left" | "none"): void {
    testApp.backend.simulateMouse({
        kind: "mouse",
        button,
        x: 10,
        y: 10,
        action,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    });
}

afterEach(() => {
    vi.useRealTimers();
});

describe("Workbench — user activity from raw terminal input", () => {
    it("still active after 69 s of silence, inactive by 100 s", () => {
        vi.useFakeTimers();
        const { userActivity } = createApp();
        vi.advanceTimersByTime(69_000);
        expect(userActivity.isActive).toBe(true);
        vi.advanceTimersByTime(WALK_AWAY - 69_000);
        expect(userActivity.isActive).toBe(false);
    });

    it("a click brings the user back; wheel and focus reports do not", () => {
        vi.useFakeTimers();
        const { testApp, userActivity } = createApp();
        vi.advanceTimersByTime(WALK_AWAY);
        expect(userActivity.isActive).toBe(false);

        mouse(testApp, "scroll-up", "none");
        testApp.backend.sendRaw("\x1b[O\x1b[I"); // left the window and came back, no input
        expect(userActivity.isActive).toBe(false);

        mouse(testApp, "press", "left");
        mouse(testApp, "release", "left");
        expect(userActivity.isActive).toBe(true);
    });

    it("a raw key brings the user back while the window reads as unfocused", () => {
        vi.useFakeTimers();
        const { testApp, userActivity } = createApp();
        testApp.backend.sendRaw("\x1b[O");
        vi.advanceTimersByTime(WALK_AWAY);
        expect(userActivity.isActive).toBe(false);
        testApp.backend.sendRaw("\x1b");
        vi.advanceTimersByTime(100); // a lone ESC resolves after the escape timeout
        testApp.backend.sendRaw("a");
        expect(userActivity.isActive).toBe(true);
    });
});
