import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { PanelService } from "../../../browser/parts/panel/panelService.ts";
import type { ITerminalSessionOptions, TerminalSessionFactory } from "../common/terminalSessionFactory.ts";

import { TERMINAL_VIEW_ID, TerminalService } from "./terminalService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";

function buildHarness() {
    const views = makeViewsHarness();
    const panelService = views.panelService;
    const sessions: FakeTerminalSurface[] = [];
    const factoryOptions: ITerminalSessionOptions[] = [];
    // Локальная фабрика, записывающая созданные сессии — так тест видит инстансы.
    const factory: TerminalSessionFactory = (options) => {
        factoryOptions.push(options);
        const surface = new FakeTerminalSurface();
        sessions.push(surface);
        return surface;
    };
    const service = new TerminalService(panelService, views.service, factory);
    return { panelService, views, service, created: sessions, factoryOptions };
}

describe("TerminalService — instances", () => {
    it("registers the TERMINAL tab and stays lazy — no session until first open", () => {
        const h = buildHarness();
        const tab = h.panelService.getViews().find((v) => v.id === TERMINAL_VIEW_ID);
        expect(tab?.title).toBe("TERMINAL");
        // Тела у секции ещё нет — вкладка рисует пустое состояние.
        expect(h.views.paneView(TERMINAL_VIEW_ID).querySelector("#viewPlaceholder-terminal")).not.toBeNull();
        expect(h.created).toHaveLength(0);
        expect(h.service.hasOpenTerminals).toBe(false);
        expect(h.service.getActiveInstance()).toBeNull();
        h.service.dispose();
    });

    it("spawns a session on first open and fires open/active/focus events", () => {
        const h = buildHarness();
        const onOpen = vi.fn();
        const onActive = vi.fn();
        const onFocus = vi.fn();
        h.service.onDidOpenInstance(onOpen);
        h.service.onDidChangeActiveInstance(onActive);
        h.service.onDidRequestFocus(onFocus);

        h.service.openTerminal();

        expect(h.created).toHaveLength(1);
        expect(h.service.hasOpenTerminals).toBe(true);
        expect(h.service.getActiveInstance()?.session).toBe(h.created[0]);
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onActive).toHaveBeenCalledWith(h.service.getActiveInstance());
        expect(onFocus).toHaveBeenCalledTimes(1);
        h.service.dispose();
    });

    it("reuses the active instance on subsequent opens (no extra session)", () => {
        const h = buildHarness();
        h.service.openTerminal();
        h.service.openTerminal();
        expect(h.created).toHaveLength(1);
        h.service.dispose();
    });

    it("makes a second terminal the active one (Create New Terminal)", () => {
        const h = buildHarness();
        h.service.openTerminal();
        h.service.newTerminal();
        expect(h.created).toHaveLength(2);
        expect(h.service.getInstances()).toHaveLength(2);
        expect(h.service.getActiveInstance()?.session).toBe(h.created[1]);
        h.service.dispose();
    });

    it("focusActive fires the focus request", () => {
        const h = buildHarness();
        const onFocus = vi.fn();
        h.service.onDidRequestFocus(onFocus);
        h.service.openTerminal();
        h.service.focusActive();
        expect(onFocus).toHaveBeenCalledTimes(2); // open + explicit focus
        h.service.dispose();
    });

    it("disposes all sessions on dispose (kills PTYs)", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        h.service.dispose();
        expect(h.created[0].disposed).toBe(true);
        expect(h.created[1].disposed).toBe(true);
    });
});

describe("TerminalService — tab activation", () => {
    it("spawns and focuses the terminal when its own tab is user-activated", () => {
        const h = buildHarness();
        const onFocus = vi.fn();
        h.service.onDidRequestFocus(onFocus);

        h.panelService.activateView(TERMINAL_VIEW_ID);

        expect(h.created).toHaveLength(1);
        expect(h.service.hasOpenTerminals).toBe(true);
        expect(onFocus).toHaveBeenCalledTimes(1);
        h.service.dispose();
    });

    it("ignores activation of a view that is not the terminal", () => {
        const h = buildHarness();
        h.panelService.addView({ id: "problems", title: "PROBLEMS" });
        h.panelService.activateView("problems");
        expect(h.created).toHaveLength(0);
        expect(h.service.hasOpenTerminals).toBe(false);
        h.service.dispose();
    });
});

describe("TerminalService — exit handling", () => {
    it("removes the instance, resets the active one, and respawns on next open when the shell exits", () => {
        const h = buildHarness();
        const onClose = vi.fn();
        const onActive = vi.fn();
        h.service.onDidCloseInstance(onClose);
        h.service.openTerminal();
        h.service.onDidChangeActiveInstance(onActive);
        const instance = h.service.getActiveInstance();

        h.created[0].emitExit(0);

        expect(h.service.hasOpenTerminals).toBe(false);
        expect(h.service.getActiveInstance()).toBeNull();
        expect(h.created[0].disposed).toBe(true);
        expect(onClose).toHaveBeenCalledWith(instance);
        // Терминалов не осталось — активный инстанс обнулён (placeholder вкладки).
        expect(onActive).toHaveBeenCalledWith(null);

        // Следующее открытие спавнит новый шелл.
        h.service.openTerminal();
        expect(h.created).toHaveLength(2);
        expect(h.service.hasOpenTerminals).toBe(true);
        h.service.dispose();
    });

    it("falls back to the previous terminal when the active one exits", () => {
        const h = buildHarness();
        h.service.newTerminal(); // #1
        h.service.newTerminal(); // #2 active
        expect(h.created).toHaveLength(2);

        h.created[1].emitExit(0); // active exits → fall back to #1
        expect(h.service.hasOpenTerminals).toBe(true);
        expect(h.service.getActiveInstance()?.session).toBe(h.created[0]);
        expect(h.created[1].disposed).toBe(true);
        expect(h.created[0].disposed).toBe(false);
        h.service.dispose();
    });

    it("keeps the active terminal when a NON-active one exits", () => {
        const h = buildHarness();
        const onActive = vi.fn();
        h.service.newTerminal(); // #1
        h.service.newTerminal(); // #2 — активный
        h.service.onDidChangeActiveInstance(onActive);

        h.created[0].emitExit(0); // выходит НЕактивный #1

        expect(h.service.getActiveInstance()?.session).toBe(h.created[1]);
        expect(onActive).not.toHaveBeenCalled();
        expect(h.created[1].disposed).toBe(false);
        expect(h.created[0].disposed).toBe(true);
        expect(h.service.hasOpenTerminals).toBe(true);
        h.service.dispose();
    });

    it("unsubscribes from a session it removed, so a repeated exit is inert", () => {
        const h = buildHarness();
        h.service.openTerminal();
        h.created[0].emitExit(0);
        expect(h.service.hasOpenTerminals).toBe(false);

        // Подписку рвёт destroyInstance, поэтому повторный сигнал выхода до сервиса
        // уже не доходит и ничего не ломает.
        expect(() => {
            h.created[0].emitExit(0);
        }).not.toThrow();
        expect(h.service.hasOpenTerminals).toBe(false);
        h.service.dispose();
    });

    it("stops reacting to a session's exit after service dispose", () => {
        const h = buildHarness();
        h.service.openTerminal();
        h.service.dispose();

        // dispose() снял подписки — «поздний» выход PTY не должен трогать сервис.
        expect(() => {
            h.created[0].emitExit(0);
        }).not.toThrow();
        expect(h.service.hasOpenTerminals).toBe(false);
    });
});

describe("TerminalService — working directory", () => {
    it("spawns in the configured working directory", () => {
        const h = buildHarness();
        h.service.setWorkingDirectory("/tmp/workspace-folder");
        h.service.openTerminal();

        expect(h.factoryOptions[0].cwd).toBe("/tmp/workspace-folder");
        h.service.dispose();
    });

    it("falls back to process.cwd() when no working directory was set", () => {
        const h = buildHarness();
        h.service.openTerminal();

        expect(h.factoryOptions[0].cwd).toBe(process.cwd());
        h.service.dispose();
    });
});

describe("TerminalService — instance title", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("names instances after $SHELL, falling back to bash", () => {
        vi.stubEnv("SHELL", undefined);
        const h = buildHarness();
        h.service.openTerminal();
        expect(h.service.getInstances()[0].title).toBe("bash (1)");
        h.service.dispose();
    });

    it("uses the basename of $SHELL", () => {
        vi.stubEnv("SHELL", "/usr/bin/zsh");
        const h = buildHarness();
        h.service.openTerminal();
        expect(h.service.getInstances()[0].title).toBe("zsh (1)");
        h.service.dispose();
    });
});
