import { BoxConstraints, Offset, Size } from "@tuidom/core/common/geometryPromitives";
import { FocusManager } from "@tuidom/core/dom/events/focusManager";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import { AuxiliaryBarService } from "../../../browser/parts/auxiliarybar/auxiliaryBarService.ts";
import { PanelService } from "../../../browser/parts/panel/panelService.ts";
import { WorkbenchLayoutElement } from "../../../browser/workbenchLayoutElement.ts";
import {
    AUXILIARYBAR_ACTIVE_VIEW_STATE,
    AUXILIARYBAR_HIDDEN_STATE,
    AUXILIARYBAR_SIZE_STATE,
} from "../../../common/stateKeys.ts";

import { LayoutService } from "./layoutService.ts";

interface Options {
    readonly defaultVisibility?: string;
    readonly folder?: boolean;
    readonly views?: readonly string[];
    readonly stored?: Readonly<Record<string, unknown>>;
}

class FocusablePart extends TUIElement {
    public constructor() {
        super();
        this.focusable = true;
    }
}

function setup(options: Options = {}) {
    const stored = new Map<string, unknown>(Object.entries(options.stored ?? {}));
    /** И те записи, что значение не меняют. */
    const writes: string[] = [];
    const state: IStateService = {
        ...NULL_STATE_SERVICE,
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            writes.push(descriptor.key);
            stored.set(descriptor.key, value);
        },
    };
    const settings =
        options.defaultVisibility === undefined
            ? {}
            : { "workbench.secondarySideBar.defaultVisibility": options.defaultVisibility };
    const workspace = new WorkspaceContextService();
    if (options.folder === true) workspace.setWorkspaceFolder("/projects/demo");
    const auxiliaryBarService = new AuxiliaryBarService();
    for (const id of options.views ?? []) auxiliaryBarService.addView({ id, title: id.toUpperCase() });
    const panelService = new PanelService();
    const contextKeys = new ContextKeyService();
    const service = new LayoutService(
        state,
        panelService,
        contextKeys,
        auxiliaryBarService,
        new InMemoryConfigurationService(undefined, settings),
        workspace,
    );

    const sidebar = new FocusablePart();
    const editor = new FocusablePart();
    const panel = new FocusablePart();
    const auxiliaryBar = new FocusablePart();
    const layout = new WorkbenchLayoutElement();
    layout.setLeftPanel(sidebar);
    layout.setCenterContent(editor);
    layout.setBottomPanel(panel);
    layout.setRightPanel(auxiliaryBar);
    const root = new BodyElement();
    root.setContent(layout);
    root.setAsRoot();
    // FocusManager у живого корня ставит TuiApplication.run — здесь его роль играет тест.
    root.focusManager = new FocusManager(root);
    service.attachRoot(root);
    service.attachLayout(layout);
    const performLayout = (): void => {
        root.localPosition = new Offset(0, 0);
        root.layout(BoxConstraints.tight(new Size(100, 30)));
    };
    performLayout();
    return {
        service,
        layout,
        stored,
        writes,
        contextKeys,
        auxiliaryBarService,
        parts: { sidebar, editor, panel, auxiliaryBar },
        performLayout,
        focus: (part: TUIElement) => {
            root.focusManager?.setFocus(part);
        },
    };
}

describe("LayoutService: вторичная боковая панель", () => {
    describe("видимость на старте (restoreLayout)", () => {
        it("впервые открытая папка: дефолт эталона visibleInWorkspace показывает часть", () => {
            const { service, layout, contextKeys, auxiliaryBarService } = setup({ folder: true, views: ["a"] });
            service.restoreLayout();
            expect(layout.getRightPanelVisible()).toBe(true);
            expect(auxiliaryBarService.visible).toBe(true);
            expect(contextKeys.get("auxiliaryBarVisible")).toBe(true);
        });

        it("visibleInWorkspace в пустом окне — скрыта", () => {
            const { service, layout } = setup({ folder: false, views: ["a"] });
            service.restoreLayout();
            expect(layout.getRightPanelVisible()).toBe(false);
        });

        it.each([
            ["hidden", true, false],
            ["hidden", false, false],
            ["visible", false, true],
            ["visible", true, true],
            ["maximized", false, true],
            ["maximizedInWorkspace", true, true],
            ["maximizedInWorkspace", false, false],
            ["visibleInWorkspace", true, true],
        ])("defaultVisibility=%s, папка=%s → видима=%s", (setting, folder, visible) => {
            const { service, layout } = setup({ defaultVisibility: setting, folder, views: ["a"] });
            service.restoreLayout();
            expect(layout.getRightPanelVisible()).toBe(visible);
        });

        it("сохранённая видимость перебивает настройку", () => {
            const shown = setup({
                defaultVisibility: "hidden",
                views: ["a"],
                stored: { [AUXILIARYBAR_HIDDEN_STATE.key]: false },
            });
            shown.service.restoreLayout();
            expect(shown.layout.getRightPanelVisible()).toBe(true);

            const hidden = setup({
                defaultVisibility: "visible",
                views: ["a"],
                stored: { [AUXILIARYBAR_HIDDEN_STATE.key]: true },
            });
            hidden.service.restoreLayout();
            expect(hidden.layout.getRightPanelVisible()).toBe(false);
        });

        it("часть без единой вкладки не показывается, даже если сохранена видимой", () => {
            const { service, layout, auxiliaryBarService, contextKeys } = setup({
                defaultVisibility: "visible",
                stored: { [AUXILIARYBAR_HIDDEN_STATE.key]: false },
            });
            service.restoreLayout();
            expect(layout.getRightPanelVisible()).toBe(false);
            expect(auxiliaryBarService.visible).toBe(false);
            expect(contextKeys.get("auxiliaryBarVisible")).toBe(false);
        });

        it("ширина и активная вкладка восстанавливаются, рестор сам ничего не пишет", () => {
            const { service, layout, auxiliaryBarService, stored, writes } = setup({
                views: ["a", "b"],
                folder: true,
                stored: { [AUXILIARYBAR_SIZE_STATE.key]: 44, [AUXILIARYBAR_ACTIVE_VIEW_STATE.key]: "b" },
            });
            service.restoreLayout();
            expect(layout.getRightPanelWidth()).toBe(44);
            expect(auxiliaryBarService.getActiveViewId()).toBe("b");
            expect(stored.has(AUXILIARYBAR_HIDDEN_STATE.key)).toBe(false);
            // Ни одной записи, даже того же значения: смена вкладки при ресторе — не выбор пользователя.
            expect(writes).toEqual([]);
        });

        it("без сохранённой вкладки активной остаётся та, что выбрал сервис части", () => {
            const { service, auxiliaryBarService } = setup({ views: ["a", "b"], folder: true });
            service.restoreLayout();
            expect(auxiliaryBarService.getActiveViewId()).toBe("a");
        });
    });

    describe("персист (write-through)", () => {
        it("показ и скрытие пишут видимость, ширина без ресайза остаётся динамической (null)", () => {
            const { service, stored, layout, contextKeys } = setup({ views: ["a"] });
            service.restoreLayout();
            service.setAuxiliaryBarVisible(true);
            expect(layout.getRightPanelVisible()).toBe(true);
            expect(contextKeys.get("auxiliaryBarVisible")).toBe(true);
            expect(stored.get(AUXILIARYBAR_HIDDEN_STATE.key)).toBe(false);
            expect(stored.get(AUXILIARYBAR_SIZE_STATE.key)).toBeNull();

            service.setAuxiliaryBarVisible(false);
            expect(stored.get(AUXILIARYBAR_HIDDEN_STATE.key)).toBe(true);
            expect(contextKeys.get("auxiliaryBarVisible")).toBe(false);
        });

        it("ресайз с клавиатуры пишет ширину", () => {
            const { service, stored, performLayout } = setup({ views: ["a"] });
            service.restoreLayout();
            service.setAuxiliaryBarVisible(true);
            performLayout();
            service.nudgeAuxiliaryBarWidth(3);
            // 100 колонок: дефолт 25 (четверть окна) + 3.
            expect(stored.get(AUXILIARYBAR_SIZE_STATE.key)).toBe(28);
        });

        it("смена активной вкладки пишется сразу, во время рестора — нет", () => {
            const { service, stored, auxiliaryBarService } = setup({
                views: ["a", "b"],
                stored: { [AUXILIARYBAR_ACTIVE_VIEW_STATE.key]: "b" },
            });
            service.restoreLayout();
            expect(stored.get(AUXILIARYBAR_ACTIVE_VIEW_STATE.key)).toBe("b");
            auxiliaryBarService.setActiveView("a");
            expect(stored.get(AUXILIARYBAR_ACTIVE_VIEW_STATE.key)).toBe("a");
        });

        it("captureLayout без вкладок пишет пустой id", () => {
            const { service, stored } = setup();
            service.captureLayout();
            expect(stored.get(AUXILIARYBAR_ACTIVE_VIEW_STATE.key)).toBe("");
        });

        it("видимость меняется и до attachLayout — ключ не отстаёт", () => {
            const auxiliaryBarService = new AuxiliaryBarService();
            const contextKeys = new ContextKeyService();
            const service = new LayoutService(
                NULL_STATE_SERVICE,
                new PanelService(),
                contextKeys,
                auxiliaryBarService,
                new InMemoryConfigurationService(),
                new WorkspaceContextService(),
            );
            expect(contextKeys.get("auxiliaryBarVisible")).toBe(false);
            service.setAuxiliaryBarVisible(true);
            expect(contextKeys.get("auxiliaryBarVisible")).toBe(true);
        });
    });

    describe("часть с фокусом и ресайз по фокусу", () => {
        function shown() {
            const env = setup({ views: ["a"], folder: true });
            env.service.restoreLayout();
            env.service.setPanelVisible(true);
            env.performLayout();
            return env;
        }

        it("getFocusedPart определяет часть по поддереву фокуса", () => {
            const { service, parts, focus } = shown();
            expect(service.getFocusedPart()).toBe("editor");
            focus(parts.sidebar);
            expect(service.getFocusedPart()).toBe("sidebar");
            focus(parts.auxiliaryBar);
            expect(service.getFocusedPart()).toBe("auxiliarybar");
            focus(parts.panel);
            expect(service.getFocusedPart()).toBe("panel");
            focus(parts.editor);
            expect(service.getFocusedPart()).toBe("editor");
        });

        it("без корня или без менеджера фокуса — редактор", () => {
            const service = new LayoutService(
                NULL_STATE_SERVICE,
                new PanelService(),
                new ContextKeyService(),
                new AuxiliaryBarService(),
                new InMemoryConfigurationService(),
                new WorkspaceContextService(),
            );
            service.attachLayout(new WorkbenchLayoutElement());
            expect(service.getFocusedPart()).toBe("editor");
            // Живой корень получает FocusManager только в TuiApplication.run.
            service.attachRoot(new BodyElement());
            expect(service.getFocusedPart()).toBe("editor");
        });

        it("фокус во вторичной панели — меняется её ширина", () => {
            const { service, parts, focus, layout } = shown();
            focus(parts.auxiliaryBar);
            service.resizeFocusedPart(3, 1);
            expect(layout.getRightPanelWidth()).toBe(28);
            expect(layout.getLeftPanelWidth()).toBe(30);
        });

        it("фокус в сайдбаре — его ширина", () => {
            const { service, parts, focus, layout } = shown();
            focus(parts.sidebar);
            service.resizeFocusedPart(-3, -1);
            expect(layout.getLeftPanelWidth()).toBe(27);
            expect(layout.getRightPanelWidth()).toBeNull();
        });

        it("фокус в панели — её высота", () => {
            const { service, parts, focus, layout } = shown();
            focus(parts.panel);
            service.resizeFocusedPart(3, 2);
            expect(layout.getBottomPanelHeight()).toBe(14);
            expect(layout.getLeftPanelWidth()).toBe(30);
        });

        it("редактор растёт за счёт вторичной панели по ширине и панели по высоте", () => {
            const { service, layout } = shown();
            service.resizeFocusedPart(3, 1);
            expect(layout.getRightPanelWidth()).toBe(22);
            expect(layout.getLeftPanelWidth()).toBe(30);
            expect(layout.getBottomPanelHeight()).toBe(11);
        });

        it("без вторичной панели редактор растёт за счёт сайдбара", () => {
            const { service, layout } = shown();
            service.setAuxiliaryBarVisible(false);
            service.setPanelVisible(false);
            service.resizeFocusedPart(3, 1);
            expect(layout.getLeftPanelWidth()).toBe(27);
            expect(layout.getBottomPanelHeight()).toBe(12);
        });

        it("без боковых частей редактору расти некуда по ширине", () => {
            const { service, layout } = shown();
            service.setAuxiliaryBarVisible(false);
            service.setSidebarVisible(false);
            service.resizeFocusedPart(3, 0);
            expect(layout.getLeftPanelWidth()).toBe(30);
            expect(layout.getRightPanelWidth()).toBeNull();
        });
    });
});
