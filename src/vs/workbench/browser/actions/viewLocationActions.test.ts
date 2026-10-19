import { describe, expect, it } from "vitest";

import { ContextKeyService, ContextKeyServiceDIToken } from "../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor, Token } from "../../../platform/instantiation/common/diContainer.ts";
import type { QuickPickItem } from "../../common/quickPickItem.ts";
import { NotificationServiceDIToken } from "../../services/notification/browser/notificationService.ts";
import { AuxiliaryBarServiceDIToken } from "../parts/auxiliarybar/auxiliaryBarService.ts";
import { PanelServiceDIToken } from "../parts/panel/panelService.ts";
import type { QuickPickOptions } from "../parts/quickinput/quickInputService.ts";
import { QuickInputServiceDIToken } from "../parts/quickinput/quickInputService.ts";
import type { IViewsHarness } from "../parts/views/viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "../parts/views/viewsService.testUtils.ts";
import { ViewsServiceDIToken } from "../parts/views/viewsService.ts";

import {
    moveFocusedViewAction,
    movePanelToSecondarySideBarAction,
    moveSecondarySideBarToPanelAction,
    moveViewAction,
    resetFocusedViewLocationAction,
} from "./viewLocationActions.ts";

const EXPLORER = "workbench.view.explorer";
const EXTENSIONS = "workbench.view.extensions";
const PROBLEMS = "workbench.panel.markers";
const OUTPUT = "workbench.panel.output";
const TERMINAL = "workbench.panel.terminal";

/** Ответ выбора из списка: пункт по подписи, `null` — отмена. */
type Chooser = (options: QuickPickOptions) => string | null;

interface IScene {
    readonly h: IViewsHarness;
    readonly accessor: ServiceAccessor;
    readonly contextKeys: ContextKeyService;
    /** Каждый показанный выбор: заголовок, активный пункт и пункты «подпись · описание». */
    readonly picks: { title?: string; activeIndex?: number; items: string[] }[];
    readonly errors: unknown[];
    readonly focused: string[];
}

/**
 * Сайдбар: EXPLORER (explorer + outline — не переносится), EXTENSIONS (чужих
 * видов не принимает). Панель: PROBLEMS, OUTPUT (output + log), TERMINAL.
 */
function scene(chooser: Chooser = () => null): IScene {
    const h = makeViewsHarness();
    const focused: string[] = [];
    const view = (id: string, containerId: string, order: number, canMoveView = true) =>
        testView(id, containerId, order, {
            canMoveView,
            focus: () => {
                focused.push(id);
            },
        });
    h.service.registerContainer({ id: EXPLORER, title: "EXPLORER", location: "sidebar", order: 0 });
    h.service.registerContainer({
        id: EXTENSIONS,
        title: "EXTENSIONS",
        location: "sidebar",
        order: 1,
        rejectAddedViews: true,
    });
    h.service.registerContainer({ id: PROBLEMS, title: "PROBLEMS", location: "panel", order: 0 });
    h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel", order: 1 });
    h.service.registerContainer({ id: TERMINAL, title: "TERMINAL", location: "panel", order: 2 });
    h.service.registerView(view("explorer", EXPLORER, 0));
    h.service.registerView(view("outline", EXPLORER, 1, false));
    h.service.registerView(view("extensions", EXTENSIONS, 0));
    h.service.registerView(view("problems", PROBLEMS, 0));
    h.service.registerView(view("output", OUTPUT, 0));
    h.service.registerView(view("log", OUTPUT, 1));
    h.service.registerView(view("terminal", TERMINAL, 0));
    h.service.attachRegisteredContainers();

    const contextKeys = new ContextKeyService();
    const picks: IScene["picks"] = [];
    const errors: unknown[] = [];
    const services = new Map<Token<unknown>, unknown>([
        [ViewsServiceDIToken, h.service],
        [ContextKeyServiceDIToken, contextKeys],
        [PanelServiceDIToken, h.panelService],
        [AuxiliaryBarServiceDIToken, h.auxiliaryBarService],
        [NotificationServiceDIToken, { show: (message: unknown) => errors.push(message) }],
        [
            QuickInputServiceDIToken,
            {
                quickPick: (options: QuickPickOptions): Promise<QuickPickItem | undefined> => {
                    picks.push({
                        title: options.title,
                        activeIndex: options.activeIndex,
                        items: options.items.map((item) =>
                            item.description === undefined ? item.label : `${item.label} · ${item.description}`,
                        ),
                    });
                    const label = chooser(options);
                    return Promise.resolve(options.items.find((item) => item.label === label));
                },
            },
        ],
    ]);
    const accessor: ServiceAccessor = {
        get: <T>(token: Token<T>) => services.get(token) as T,
    };
    return { h, accessor, contextKeys, picks, errors, focused };
}

function containerOf(h: IViewsHarness, viewId: string): string | null {
    return h.service.getViewContainerByViewId(viewId);
}

describe("Move Focused View", () => {
    it("без вида с фокусом — модальная ошибка", async () => {
        const { accessor, errors, picks } = scene();
        await moveFocusedViewAction.run(accessor);
        expect(errors).toEqual([
            { severity: "error", message: "There is no view currently focused.", modal: true, items: [] },
        ]);
        expect(picks).toEqual([]);
    });

    it("пробельный id — тоже «нет вида»", async () => {
        const { accessor, errors, contextKeys } = scene();
        contextKeys.set("focusedView", "  ");
        await moveFocusedViewAction.run(accessor);
        expect(errors).toEqual([expect.objectContaining({ message: "There is no view currently focused." })]);
    });

    it("непереносимый вид — своя ошибка", async () => {
        const { accessor, errors, contextKeys } = scene();
        contextKeys.set("focusedView", "outline");
        await moveFocusedViewAction.run(accessor);
        expect(errors).toEqual([expect.objectContaining({ message: "The currently focused view is not movable." })]);
    });

    it("места: новые записи, затем чужие контейнеры по группам, без своего и не принимающих", async () => {
        const { accessor, contextKeys, picks } = scene();
        contextKeys.set("focusedView", "log");
        await moveFocusedViewAction.run(accessor);
        expect(picks).toEqual([
            {
                title: "View: Move LOG",
                activeIndex: undefined,
                items: [
                    "New Panel Entry",
                    "New Side Bar Entry",
                    "New Secondary Side Bar Entry",
                    "EXPLORER · Side Bar",
                    "PROBLEMS · Panel",
                    "TERMINAL · Panel",
                ],
            },
        ]);
    });

    it("скрытая секция: в заголовке её id", async () => {
        const { h, accessor, contextKeys, picks } = scene();
        h.service.setViewVisible("log", false);
        contextKeys.set("focusedView", "log");
        await moveFocusedViewAction.run(accessor);
        expect(picks[0].title).toBe("View: Move log");
    });

    it("единственный вид контейнера: новой записи на его же месте нет", async () => {
        const { accessor, contextKeys, picks } = scene();
        contextKeys.set("focusedView", "terminal");
        await moveFocusedViewAction.run(accessor);
        expect(picks[0].title).toBe("View: Move TERMINAL");
        expect(picks[0].items.slice(0, 2)).toEqual(["New Side Bar Entry", "New Secondary Side Bar Entry"]);
    });

    it("выбор новой записи переносит вид и фокусирует его", async () => {
        const { h, accessor, contextKeys, focused } = scene(() => "New Secondary Side Bar Entry");
        contextKeys.set("focusedView", "terminal");
        await moveFocusedViewAction.run(accessor);
        expect(h.service.getViewContainerLocation(containerOf(h, "terminal")!)).toBe("auxiliarybar");
        expect(focused).toEqual(["terminal"]);
    });

    it("выбор контейнера кладёт вид в него", async () => {
        const { h, accessor, contextKeys } = scene(() => "PROBLEMS");
        contextKeys.set("focusedView", "log");
        await moveFocusedViewAction.run(accessor);
        expect(containerOf(h, "log")).toBe(PROBLEMS);
    });

    it("отмена ничего не двигает", async () => {
        const { h, accessor, contextKeys, focused } = scene(() => null);
        contextKeys.set("focusedView", "log");
        await moveFocusedViewAction.run(accessor);
        expect(containerOf(h, "log")).toBe(OUTPUT);
        expect(focused).toEqual([]);
    });
});

describe("Move View", () => {
    it("первый шаг: переносимые виды по местам, вид с фокусом подсвечен", async () => {
        const { accessor, contextKeys, picks } = scene();
        contextKeys.set("focusedView", "output");
        await moveViewAction.run(accessor);
        expect(picks).toEqual([
            {
                title: undefined,
                activeIndex: 3,
                items: [
                    "EXPLORER · Side Bar / EXPLORER",
                    "EXTENSIONS · Side Bar / EXTENSIONS",
                    "PROBLEMS · Panel / PROBLEMS",
                    "OUTPUT · Panel / OUTPUT",
                    "LOG · Panel / OUTPUT",
                    "TERMINAL · Panel / TERMINAL",
                ],
            },
        ]);
    });

    it("вид с фокусом не из списка — подсвечен первый пункт", async () => {
        const { accessor, contextKeys, picks } = scene();
        contextKeys.set("focusedView", "outline");
        await moveViewAction.run(accessor);
        expect(picks[0].activeIndex).toBe(0);
    });

    it("выбранный вид — во второй шаг", async () => {
        const { h, accessor, picks } = scene((options) =>
            options.title === undefined ? "PROBLEMS" : "New Side Bar Entry",
        );
        await moveViewAction.run(accessor);
        expect(picks[1].title).toBe("View: Move PROBLEMS");
        expect(h.service.getViewContainerLocation(containerOf(h, "problems")!)).toBe("sidebar");
    });

    it("отмена первого шага — второго нет", async () => {
        const { accessor, picks } = scene(() => null);
        await moveViewAction.run(accessor);
        expect(picks).toHaveLength(1);
    });
});

describe("Reset Focused View Location", () => {
    it("без вида или с неизвестным видом — ошибка", async () => {
        for (const viewId of [" ", "ghost"]) {
            const { accessor, contextKeys, errors } = scene();
            contextKeys.set("focusedView", viewId);
            await resetFocusedViewLocationAction.run(accessor);
            expect(errors).toEqual([expect.objectContaining({ message: "There is no view currently focused." })]);
        }
    });

    it("вид на своём месте — ничего не делает", async () => {
        const { accessor, contextKeys, errors, focused } = scene();
        contextKeys.set("focusedView", "terminal");
        await resetFocusedViewLocationAction.run(accessor);
        expect(errors).toEqual([]);
        expect(focused).toEqual([]);
    });

    it("перенесённый вид возвращается домой и получает фокус", async () => {
        const { h, accessor, contextKeys, focused } = scene();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        contextKeys.set("focusedView", "terminal");
        await resetFocusedViewLocationAction.run(accessor);
        expect(containerOf(h, "terminal")).toBe(TERMINAL);
        expect(focused).toEqual(["terminal"]);
    });
});

describe("Move Panel Views To Secondary Side Bar и обратно", () => {
    it("в пустую часть: все контейнеры переезжают, часть видна, активный открыт и в фокусе", async () => {
        const { h, accessor, focused } = scene();
        h.panelService.setActiveView(OUTPUT);
        await movePanelToSecondarySideBarAction.run(accessor);
        for (const id of [PROBLEMS, OUTPUT, TERMINAL])
            expect(h.service.getViewContainerLocation(id)).toBe("auxiliarybar");
        expect(h.auxiliaryBarService.visible).toBe(true);
        expect(h.auxiliaryBarService.getActiveViewId()).toBe(OUTPUT);
        expect(focused).toEqual(["output"]);
    });

    it("в непустую часть: её активная вкладка остаётся, фокус не трогаем", async () => {
        const { h, accessor, focused } = scene();
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        const active = h.auxiliaryBarService.getActiveViewId();
        h.panelService.setActiveView(OUTPUT);
        await movePanelToSecondarySideBarAction.run(accessor);
        expect(h.auxiliaryBarService.getActiveViewId()).toBe(active);
        expect(h.auxiliaryBarService.visible).toBe(true);
        expect(focused).toEqual([]);
    });

    it("из пустой части — no-op", async () => {
        const { h, accessor } = scene();
        await moveSecondarySideBarToPanelAction.run(accessor);
        expect(h.panelService.visible).toBe(false);
    });

    it("обратно: вторичная панель уезжает в нижнюю", async () => {
        const { h, accessor } = scene();
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        await moveSecondarySideBarToPanelAction.run(accessor);
        expect(h.service.getViewContainerLocation(TERMINAL)).toBe("panel");
        expect(h.panelService.visible).toBe(true);
    });
});
