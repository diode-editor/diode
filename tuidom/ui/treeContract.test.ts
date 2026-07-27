import { describe, expect, it } from "vitest";

import { Point } from "../common/geometryPromitives.ts";
import { TUIElement } from "../dom/tuiElement.ts";
import { validateTree } from "../dom/validateTree.ts";

import { BodyElement } from "./body/bodyElement.ts";
import { OverlayLayer } from "./contextview/overlayLayer.ts";
import { EditorGroupElement } from "./editorgroup/editorGroupElement.ts";
import { BoxContainerElement } from "./layout/boxContainerElement.ts";
import { FitContentElement } from "./layout/fitContentElement.ts";
import { HFlexElement, hflexFill } from "./layout/hFlexElement.ts";
import { PaddingContainerElement } from "./layout/paddingContainerElement.ts";
import { SizedBoxElement } from "./layout/sizedBoxElement.ts";
import { VStackElement } from "./layout/vStackElement.ts";
import { ListViewElement } from "./list/listViewElement.ts";
import { PanelContainerElement } from "./panel/panelContainerElement.ts";
import { ScrollContainerElement } from "./scrollbar/scrollContainerElement.ts";
import { ScrollViewport } from "./scrollbar/scrollViewport.ts";
import { TitledPanelElement } from "./titledpanel/titledPanelElement.ts";
import { WorkbenchLayoutElement } from "./workbenchlayout/workbenchLayoutElement.ts";

/**
 * Контрактный тест на топологию дерева — один на все контейнеры.
 *
 * Сценарий — тот временно́й порядок, на котором ловились реальные баги
 * (#204 и родня): ребёнка прикрепляют, пока контейнер ещё НЕ укоренён,
 * контейнер укореняют потом. Ожидание: после укоренения каждый прикреплённый
 * элемент полностью в дереве — parent-симметрия и root (иначе focus()/open()
 * молча не работают, markStyleDirty не находит путь вверх и т.д.).
 *
 * Кейсы, где контейнер прячет часть детей из getChildren() (неактивная
 * вкладка панели, скрытая нижняя панель) — отдельными тестами ниже: это
 * ровно те места, где нисходящая пропагация root дырявая по построению.
 */

interface ContainerCase {
    readonly name: string;
    /** Собирает контейнер с уже прикреплённым ребёнком; возвращает обоих. */
    readonly build: () => { container: TUIElement; child: TUIElement };
}

class ContentSizedElement extends TUIElement {
    public readonly contentHeight = 10;
    public readonly contentWidth = 10;
    public readonly scrollTop = 0;
    public readonly scrollLeft = 0;
}

const CASES: ContainerCase[] = [
    {
        name: "VStackElement",
        build: () => {
            const container = new VStackElement();
            const child = new TUIElement();
            container.addChild(child, { width: "fill", height: 1 });
            return { container, child };
        },
    },
    {
        name: "HFlexElement",
        build: () => {
            const container = new HFlexElement();
            const child = new TUIElement();
            container.addChild(child, { width: hflexFill(), height: 1 });
            return { container, child };
        },
    },
    {
        name: "BoxContainerElement",
        build: () => {
            const container = new BoxContainerElement();
            const child = new TUIElement();
            container.setChild(child);
            return { container, child };
        },
    },
    {
        name: "SizedBoxElement",
        build: () => {
            const container = new SizedBoxElement(10, 5);
            const child = new TUIElement();
            container.setChild(child);
            return { container, child };
        },
    },
    {
        name: "PaddingContainerElement",
        build: () => {
            const child = new TUIElement();
            const container = new PaddingContainerElement(child);
            return { container, child };
        },
    },
    {
        name: "FitContentElement",
        build: () => {
            const container = new FitContentElement();
            const child = new TUIElement();
            container.setChild(child);
            return { container, child };
        },
    },
    {
        name: "TitledPanelElement",
        build: () => {
            const child = new TUIElement();
            const container = new TitledPanelElement("title", child);
            return { container, child };
        },
    },
    {
        name: "ScrollViewport",
        build: () => {
            const child = new ContentSizedElement();
            const container = new ScrollViewport(child);
            return { container, child };
        },
    },
    {
        name: "ScrollContainerElement",
        build: () => {
            const child = new ContentSizedElement();
            const container = new ScrollContainerElement(child);
            return { container, child };
        },
    },
    {
        name: "ListViewElement",
        build: () => {
            const container = new ListViewElement();
            const child = new TUIElement();
            child.id = "row-1";
            container.appendRow(child);
            return { container, child };
        },
    },
    {
        name: "OverlayLayer (видимый item)",
        build: () => {
            const container = new OverlayLayer();
            const child = new TUIElement();
            container.addItem(child, new Point(0, 0), true);
            return { container, child };
        },
    },
    {
        name: "OverlayLayer (скрытый item)",
        build: () => {
            const container = new OverlayLayer();
            const child = new TUIElement();
            container.addItem(child, new Point(0, 0), false);
            return { container, child };
        },
    },
    {
        name: "EditorGroupElement",
        build: () => {
            const container = new EditorGroupElement();
            const child = new TUIElement();
            container.setContent(child);
            return { container, child };
        },
    },
    {
        name: "WorkbenchLayoutElement (видимая левая панель)",
        build: () => {
            const container = new WorkbenchLayoutElement();
            const child = new TUIElement();
            container.setLeftPanel(child);
            return { container, child };
        },
    },
    {
        name: "PanelContainerElement (активная вкладка)",
        build: () => {
            const container = new PanelContainerElement();
            const child = new TUIElement();
            container.addView({ id: "first", title: "FIRST", content: child });
            return { container, child };
        },
    },
    {
        name: "PanelContainerElement (actions активной вкладки)",
        build: () => {
            const container = new PanelContainerElement();
            const child = new TUIElement();
            container.addView({ id: "first", title: "FIRST", content: null, actions: child });
            return { container, child };
        },
    },
];

function rootInto(container: TUIElement): BodyElement {
    const body = new BodyElement();
    body.setContent(container);
    return body;
}

describe("контракт контейнера: прикрепили до укоренения → укоренили", () => {
    describe.each(CASES)("$name", ({ build }) => {
        it("ребёнок полностью в дереве: parent-симметрия и root", () => {
            const { container, child } = build();
            expect(child.getRoot()).toBeNull(); // ещё не укоренены — норм

            const body = rootInto(container);

            expect(child.getParent()).not.toBeNull();
            expect(child.getRoot()).toBe(body);
            expect(validateTree(body)).toEqual([]);
        });

        it("прикрепление после укоренения — эквивалентно", () => {
            const { container, child } = build();
            const body = rootInto(container);
            expect(child.getRoot()).toBe(body);
            expect(validateTree(body)).toEqual([]);
        });
    });
});

describe("контракт контейнера: дети, скрытые из getChildren()", () => {
    // Эти кейсы — источник семейства багов #204: контейнер не отдаёт часть
    // детей из getChildren(), нисходящая пропагация root их не видит, и после
    // активации они остаются с root=null (focus/open — молчаливый no-op).
    // Сейчас закрыты точечными перецеплениями в контейнерах; этап 3 (hidden-флаг
    // вместо исключения из структуры) заменит механизм, ожидания не изменятся.

    it("неактивная вкладка панели укореняется при активации", () => {
        const container = new PanelContainerElement();
        const first = new TUIElement();
        const second = new TUIElement();
        container.addView({ id: "first", title: "FIRST", content: first });
        container.addView({ id: "second", title: "SECOND", content: second });

        const body = rootInto(container);
        container.setActiveView("second");

        expect(second.getRoot()).toBe(body);
    });

    it("actions вкладки, прикреплённые до укоренения, укореняются после активации", () => {
        // Точная модель #204: restore сессии прикрепляет селектор канала к ещё
        // не укоренённой панели; вкладка становится активной без клика.
        const container = new PanelContainerElement();
        const actions = new TUIElement();
        container.addView({ id: "output", title: "OUTPUT", content: null });
        container.setViewActions("output", actions);

        const inactive = new TUIElement();
        container.addView({ id: "other", title: "OTHER", content: inactive });
        container.setActiveView("other");

        rootInto(container); // укореняем, пока активна другая вкладка
        container.setActiveView("output");

        expect(actions.getRoot()).not.toBeNull();
    });

    it.fails("[этап 3] скрытая нижняя панель укореняется вместе с layout", () => {
        const container = new WorkbenchLayoutElement();
        const bottom = new TUIElement();
        container.setBottomPanel(bottom);
        container.setBottomPanelVisible(false);

        const body = rootInto(container);

        expect(bottom.getRoot()).toBe(body);
    });
});
