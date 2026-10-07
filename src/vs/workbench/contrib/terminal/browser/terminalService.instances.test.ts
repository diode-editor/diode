import { describe, expect, it, vi } from "vitest";

import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";

import { TERMINAL_VIEW_ID, TerminalService } from "./terminalService.ts";

/** Стенд: сервис с N терминалами (последний активный) и видимой вкладкой TERMINAL. */
function buildHarness(count: number, settings: Readonly<Record<string, unknown>> = {}) {
    const views = makeViewsHarness();
    const sessions: FakeTerminalSurface[] = [];
    const service = new TerminalService(
        views.panelService,
        views.service,
        createTestConfigurationService(settings),
        () => {
            const surface = new FakeTerminalSurface();
            sessions.push(surface);
            return surface;
        },
    );
    views.service.attachRegisteredContainers();
    views.panelService.setActiveView(TERMINAL_VIEW_ID);
    views.panelService.setVisible(true);
    for (let i = 0; i < count; i++) service.newTerminal();
    const ids = (): number[] => service.getInstances().map((i) => i.id);
    const activeIndex = (): number => service.getInstances().indexOf(service.getActiveInstance() as never);
    return { views, service, sessions, ids, activeIndex };
}

describe("TerminalService — switching the active instance", () => {
    it("setActiveInstance switches and fires the change once; no-op for the active or an unknown id", () => {
        const h = buildHarness(3);
        const onActive = vi.fn();
        const onFocus = vi.fn();
        h.service.onDidChangeActiveInstance(onActive);
        h.service.onDidRequestFocus(onFocus);
        const [first] = h.ids();

        h.service.setActiveInstance(first);
        expect(h.activeIndex()).toBe(0);
        expect(onActive).toHaveBeenCalledTimes(1);
        expect(onActive).toHaveBeenCalledWith(h.service.getInstance(first));
        // Активация — не фокус: так ходят стрелки по списку вкладок эталона.
        expect(onFocus).not.toHaveBeenCalled();

        h.service.setActiveInstance(first);
        h.service.setActiveInstance(9999);
        expect(onActive).toHaveBeenCalledTimes(1);
        h.service.dispose();
    });

    it("setActiveInstanceByIndex accepts only indexes inside the list", () => {
        const h = buildHarness(3);
        h.service.setActiveInstanceByIndex(0);
        expect(h.activeIndex()).toBe(0);
        h.service.setActiveInstanceByIndex(2);
        expect(h.activeIndex()).toBe(2);
        h.service.setActiveInstanceByIndex(-1);
        expect(h.activeIndex()).toBe(2);
        h.service.setActiveInstanceByIndex(3);
        expect(h.activeIndex()).toBe(2);
        h.service.dispose();
    });

    it("next/previous cycle through the instances in both directions", () => {
        const h = buildHarness(3); // активен #3 (индекс 2)
        h.service.setActiveToNext();
        expect(h.activeIndex()).toBe(0); // через край — к первому
        h.service.setActiveToNext();
        expect(h.activeIndex()).toBe(1);
        h.service.setActiveToPrevious();
        expect(h.activeIndex()).toBe(0);
        h.service.setActiveToPrevious();
        expect(h.activeIndex()).toBe(2); // через край назад — к последнему
        h.service.dispose();
    });

    it("next/previous are no-ops without terminals", () => {
        const h = buildHarness(0);
        expect(() => {
            h.service.setActiveToNext();
            h.service.setActiveToPrevious();
        }).not.toThrow();
        expect(h.service.getActiveInstance()).toBeNull();
        h.service.dispose();
    });

    it("next/previous are no-ops with a single terminal", () => {
        const h = buildHarness(1);
        const onActive = vi.fn();
        h.service.onDidChangeActiveInstance(onActive);
        h.service.setActiveToNext();
        h.service.setActiveToPrevious();
        expect(onActive).not.toHaveBeenCalled();
        h.service.dispose();
    });

    it("getInstance finds open instances only", () => {
        const h = buildHarness(2);
        const [first, second] = h.ids();
        expect(h.service.getInstance(second)?.id).toBe(second);
        h.service.closeInstance(first);
        expect(h.service.getInstance(first)).toBeNull();
        h.service.dispose();
    });

    it("terminalCount follows the number of open instances", () => {
        const h = buildHarness(2);
        const keys = new ContextKeyService();
        h.service.updateContextKeys(keys);
        expect(keys.get("terminalCount")).toBe(2);
        h.service.closeInstance(h.ids()[0]);
        h.service.updateContextKeys(keys);
        expect(keys.get("terminalCount")).toBe(1);
        h.service.dispose();
    });
});

describe("TerminalService — closeInstance (kill)", () => {
    it("kills the PTY, drops the instance and fires close", () => {
        const h = buildHarness(2);
        const onClose = vi.fn();
        h.service.onDidCloseInstance(onClose);
        const victim = h.service.getInstances()[0];

        h.service.closeInstance(victim.id);

        expect(h.sessions[0].disposed).toBe(true);
        expect(h.sessions[1].disposed).toBe(false);
        expect(onClose).toHaveBeenCalledWith(victim);
        expect(h.ids()).toHaveLength(1);
        // Убили неактивный — активный не меняется.
        expect(h.service.getActiveInstance()?.session).toBe(h.sessions[1]);
        h.service.dispose();
    });

    it("activates the neighbour at the same index when the active one is killed (removeGroup of the reference)", () => {
        const h = buildHarness(3);
        h.service.setActiveInstanceByIndex(1);
        const onActive = vi.fn();
        h.service.onDidChangeActiveInstance(onActive);

        h.service.closeInstance(h.ids()[1]);

        // Был средний — активным стал следующий (тот, что встал на его индекс).
        expect(h.service.getActiveInstance()?.session).toBe(h.sessions[2]);
        expect(onActive).toHaveBeenCalledTimes(1);
        h.service.dispose();
    });

    it("activates the new last one when the active last one is killed", () => {
        const h = buildHarness(3); // активен последний
        h.service.closeInstance(h.ids()[2]);
        expect(h.service.getActiveInstance()?.session).toBe(h.sessions[1]);
        h.service.dispose();
    });

    it("is a no-op for an unknown id", () => {
        const h = buildHarness(1);
        const onClose = vi.fn();
        h.service.onDidCloseInstance(onClose);
        h.service.closeInstance(9999);
        expect(onClose).not.toHaveBeenCalled();
        expect(h.ids()).toHaveLength(1);
        h.service.dispose();
    });

    it("hides the panel when the last terminal is closed (hideOnLastClosed, default true)", () => {
        const h = buildHarness(1);
        h.service.closeInstance(h.ids()[0]);
        expect(h.service.getActiveInstance()).toBeNull();
        expect(h.views.panelService.visible).toBe(false);
        h.service.dispose();
    });

    it("keeps the panel when other terminals remain", () => {
        const h = buildHarness(2);
        h.service.closeInstance(h.ids()[1]);
        expect(h.views.panelService.visible).toBe(true);
        h.service.dispose();
    });

    it("keeps the panel with hideOnLastClosed: false", () => {
        const h = buildHarness(1, { "terminal.integrated.hideOnLastClosed": false });
        h.service.closeInstance(h.ids()[0]);
        expect(h.views.panelService.visible).toBe(true);
        h.service.dispose();
    });

    it("leaves the panel alone when another tab is active (the terminal is not what the user sees)", () => {
        const h = buildHarness(1);
        h.views.panelService.addView({ id: "problems", title: "PROBLEMS" });
        h.views.panelService.setActiveView("problems");
        h.service.closeInstance(h.ids()[0]);
        expect(h.views.panelService.visible).toBe(true);
        h.service.dispose();
    });

    it("the last shell exiting on its own also hides the panel", () => {
        const h = buildHarness(1);
        h.sessions[0].emitExit(0);
        expect(h.views.panelService.visible).toBe(false);
        h.service.dispose();
    });
});
