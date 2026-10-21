import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { resolveUserDataPaths } from "../../platform/environment/node/userDataPaths.ts";
import { loadState, type StateService } from "../../platform/state/node/stateService.ts";
import { LayoutServiceDIToken } from "../services/layout/browser/layoutService.ts";

import { AuxiliaryBarServiceDIToken } from "./parts/auxiliarybar/auxiliaryBarService.ts";
import type { PanelContainerElement } from "./parts/panel/panelContainerElement.ts";
import { ViewsServiceDIToken } from "./parts/views/viewsService.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

const TOGGLE = "workbench.action.toggleAuxiliaryBar";
const CLOSE = "workbench.action.closeAuxiliaryBar";
const FOCUS = "workbench.action.focusAuxiliaryBar";
const NEXT = "workbench.action.nextAuxiliaryBarView";
const PREVIOUS = "workbench.action.previousAuxiliaryBarView";
const INCREASE = "workbench.action.increaseViewSize";
const DECREASE = "workbench.action.decreaseViewSize";

const SIZE = new Size(100, 20);

class FocusableBody extends TUIElement {
    public constructor(id: string) {
        super();
        this.id = id;
        this.focusable = true;
    }
}

describe("Workbench — вторичная боковая панель", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-auxbar-", files: { "a.txt": "hello" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            focusEditor: true,
            size: SIZE,
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function part(): PanelContainerElement {
        return h.workbench.workbenchLayout.getRightPanel() as PanelContainerElement;
    }

    function frame(): string[] {
        h.testApp.render();
        return h.testApp.backend.screenToString().split("\n");
    }

    function visible(): boolean {
        return h.workbench.workbenchLayout.getRightPanelVisible();
    }

    function contextKey(key: "auxiliaryBarVisible" | "auxiliaryBarFocus" | "activeAuxiliary"): unknown {
        h.container.get(WorkbenchContextKeysDIToken).update();
        return h.container.get(ContextKeyServiceDIToken).get(key);
    }

    function addContainer(id: string, title: string, order: number): FocusableBody {
        const views = h.container.get(ViewsServiceDIToken);
        const body = new FocusableBody(`${id}-body`);
        views.registerContainer({ id, title, location: "auxiliarybar", order });
        views.registerView({
            id: `${id}.view`,
            containerId: id,
            title,
            order: 10,
            body,
            focus: () => {
                body.focus();
            },
        });
        views.attachContainer(id);
        return body;
    }

    function focused(): TUIElement | null {
        return h.workbench.view.focusManager?.activeElement ?? null;
    }

    it("часть — правая колонка layout'а с id auxiliarybar, на старте скрыта", () => {
        expect(part().id).toBe("auxiliarybar");
        expect(visible()).toBe(false);
        expect(contextKey("auxiliaryBarVisible")).toBe(false);
        expect(frame()[1].endsWith(" × ")).toBe(false);
    });

    it("Ctrl+Alt+B показывает пустую часть справа с кнопкой закрытия и прячет обратно", () => {
        h.testApp.sendKey("Ctrl+Alt+B");
        expect(visible()).toBe(true);
        expect(contextKey("auxiliaryBarVisible")).toBe(true);
        // Строка 1 — первая строка части (под строкой меню): кнопка `×` в правом конце.
        expect(frame()[1].endsWith(" × ")).toBe(true);
        const close = part().inspectState().close as { x: number };
        // 100 колонок: ширина по умолчанию — четверть окна, 25.
        expect(close.x).toBe(SIZE.width - 3);
        expect(part().globalPosition.x).toBe(SIZE.width - 25);

        h.testApp.sendKey("Ctrl+Alt+B");
        expect(visible()).toBe(false);
        expect(frame()[1].endsWith(" × ")).toBe(false);
    });

    it("кнопка × закрывает часть через команду; Hide на скрытой части погашена", () => {
        h.commands.execute(TOGGLE);
        part().onClose?.();
        expect(visible()).toBe(false);
        expect(contextKey("auxiliaryBarVisible")).toBe(false);
        h.commands.execute(CLOSE);
        expect(visible()).toBe(false);
    });

    it("показ отдаёт фокус активному контейнеру, скрытие возвращает его редактору", () => {
        const body = addContainer("test.aux.one", "ONE", 1);
        expect(frame()[1]).not.toContain("ONE");

        h.commands.execute(TOGGLE);
        expect(focused() === body).toBe(true);
        expect(contextKey("auxiliaryBarFocus")).toBe(true);
        expect(contextKey("activeAuxiliary")).toBe("test.aux.one");
        const row = frame()[1];
        expect(row.slice(part().globalPosition.x)).toContain("ONE");

        h.commands.execute(TOGGLE);
        // Булево, а не toBe по элементам: дифф двух узлов дерева vitest сериализует целиком.
        expect(focused()?.getAncestorPath().includes(h.activeEditor().view) ?? false).toBe(true);
        expect(contextKey("auxiliaryBarFocus")).toBe(false);
        expect(contextKey("activeAuxiliary")).toBe("");
    });

    it("Focus into Secondary Side Bar показывает скрытую часть и фокусирует её", () => {
        const body = addContainer("test.aux.one", "ONE", 1);
        h.commands.execute(FOCUS);
        expect(visible()).toBe(true);
        expect(focused() === body).toBe(true);
    });

    it("Next/Previous Secondary Side Bar View ходят по вкладкам по кругу", () => {
        // Три вкладки: на двух шаг вперёд и шаг назад неразличимы.
        addContainer("test.aux.one", "ONE", 1);
        const two = addContainer("test.aux.two", "TWO", 2);
        addContainer("test.aux.three", "THREE", 3);
        const auxiliaryBar = h.container.get(AuxiliaryBarServiceDIToken);
        expect(auxiliaryBar.getActiveViewId()).toBe("test.aux.one");

        h.commands.execute(NEXT);
        expect(auxiliaryBar.getActiveViewId()).toBe("test.aux.two");
        expect(visible()).toBe(true);
        expect(focused() === two).toBe(true);

        h.commands.execute(PREVIOUS);
        expect(auxiliaryBar.getActiveViewId()).toBe("test.aux.one");
        h.commands.execute(PREVIOUS);
        expect(auxiliaryBar.getActiveViewId()).toBe("test.aux.three");
        h.commands.execute(NEXT);
        expect(auxiliaryBar.getActiveViewId()).toBe("test.aux.one");
    });

    it("Next/Previous на пустой части ничего не делают", () => {
        h.commands.execute(NEXT);
        expect(visible()).toBe(false);
    });

    it("Increase Current View Size с фокусом в части расширяет её на кадре", () => {
        addContainer("test.aux.one", "ONE", 1);
        h.commands.execute(TOGGLE);
        h.commands.execute(INCREASE);
        frame();
        expect(part().layoutSize.width).toBe(28);
        expect(part().globalPosition.x).toBe(SIZE.width - 28);
    });

    it("Decrease Current View Size с фокусом в редакторе отдаёт его колонки части, а строки — панели", () => {
        addContainer("test.aux.one", "ONE", 1);
        const layout = h.container.get(LayoutServiceDIToken);
        layout.setAuxiliaryBarVisible(true);
        layout.setPanelVisible(true);
        frame();
        expect(layout.getFocusedPart()).toBe("editor");
        const bottom = h.workbench.workbenchLayout.getBottomPanel()!;
        const height = bottom.layoutSize.height;
        h.commands.execute(DECREASE);
        frame();
        expect(part().layoutSize.width).toBe(28);
        expect(bottom.layoutSize.height).toBe(height + 1);
    });

    it("узкий терминал (80): редактору остаётся 20 колонок, часть ужимается первой", () => {
        h.dispose();
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 20) });
        const layout = h.container.get(LayoutServiceDIToken);
        layout.setAuxiliaryBarVisible(true);
        h.workbench.workbenchLayout.setRightPanelWidth(60);
        frame();
        const left = h.workbench.workbenchLayout.getLeftPanel()!.layoutSize.width;
        expect(part().layoutSize.width).toBe(80 - 20 - left);
        expect(h.workbench.workbenchLayout.getCenterContent()!.layoutSize.width).toBe(20);
    });
});

describe("Workbench — вторичная боковая панель переживает перезапуск", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;
    let writers: StateService[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-auxbar-persist-ws-" });
        userData = createTempWorkspace({ prefix: "diode-auxbar-persist-home-" });
        writers = [];
    });

    afterEach(() => {
        for (const writer of writers) writer.dispose();
        ws.dispose();
        userData.dispose();
    });

    function launch(): { h: IAppHarness; state: StateService } {
        const state = loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }));
        writers.push(state);
        return { h: createAppTestHarness({ workspaceFolder: ws.dir, stateService: state, size: SIZE }), state };
    }

    it("ширина сохраняется; пустая часть, оставленная видимой, на старте не показывается", () => {
        const first = launch();
        const layout = first.h.container.get(LayoutServiceDIToken);
        layout.setAuxiliaryBarVisible(true);
        first.h.testApp.render();
        layout.nudgeAuxiliaryBarWidth(5);
        first.state.flushSync();
        first.h.dispose();

        const second = launch();
        const restored = second.h.workbench.workbenchLayout;
        expect(restored.getRightPanelWidth()).toBe(30);
        // Контейнеров во вторичной панели нет — показывать нечего (как у эталона).
        expect(restored.getRightPanelVisible()).toBe(false);
        second.h.dispose();
    });
});
