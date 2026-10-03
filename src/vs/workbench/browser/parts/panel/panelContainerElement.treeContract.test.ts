import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { validateTree } from "@tuidom/core/dom/validateTree";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { PanelContainerElement } from "./panelContainerElement.ts";

/**
 * Контракт топологии дерева для панели — та часть контрактного сьюта движка,
 * которая уехала вместе с виджетом (`docs/TODO/EngineWidgetRepatriation.md`).
 *
 * Сценарий здесь — тот временно́й порядок, на котором ловились реальные баги
 * семейства #204: ребёнка прикрепляют, пока панель ещё НЕ укоренена, панель
 * укореняют потом, вкладка становится активной без клика. Панель прячет
 * неактивные вкладки из кадра, и именно в таких контейнерах нисходящая
 * пропагация root дырявая по построению: с протухшим root `focus()`/`open()`
 * молча ничего не делают (так селектор каналов Output не открывал выпадашку
 * после restore сессии).
 */
function rootInto(container: TUIElement): BodyElement {
    const body = new BodyElement();
    body.setContent(container);
    return body;
}

describe("PanelContainerElement: контракт дерева", () => {
    it("контент активной вкладки, прикреплённый до укоренения, полностью в дереве", () => {
        const panel = new PanelContainerElement();
        const child = new TUIElement();
        panel.addView({ id: "first", title: "FIRST", content: child });
        expect(child.getRoot()).toBeNull(); // ещё не укоренены — норм

        const body = rootInto(panel);

        expect(child.getParent()).not.toBeNull();
        expect(child.getRoot()).toBe(body);
        expect(validateTree(body)).toEqual([]);
    });

    it("контролы активной вкладки, прикреплённые до укоренения, полностью в дереве", () => {
        const panel = new PanelContainerElement();
        const child = new TUIElement();
        panel.addView({ id: "first", title: "FIRST", content: null, actions: child });

        const body = rootInto(panel);

        expect(child.getParent()).not.toBeNull();
        expect(child.getRoot()).toBe(body);
        expect(validateTree(body)).toEqual([]);
    });

    it("неактивная вкладка укореняется при активации", () => {
        const panel = new PanelContainerElement();
        const first = new TUIElement();
        const second = new TUIElement();
        panel.addView({ id: "first", title: "FIRST", content: first });
        panel.addView({ id: "second", title: "SECOND", content: second });

        const body = rootInto(panel);
        panel.setActiveView("second");

        expect(second.getRoot()).toBe(body);
        expect(validateTree(body)).toEqual([]);
    });

    it("контролы вкладки, прикреплённые до укоренения, укореняются после активации", () => {
        // Точная модель #204: restore сессии прикрепляет селектор канала к ещё
        // не укоренённой панели; вкладка становится активной без клика.
        const panel = new PanelContainerElement();
        const actions = new TUIElement();
        panel.addView({ id: "output", title: "OUTPUT", content: null });
        panel.setViewActions("output", actions);

        const inactive = new TUIElement();
        panel.addView({ id: "other", title: "OTHER", content: inactive });
        panel.setActiveView("other");

        const body = rootInto(panel); // укореняем, пока активна другая вкладка
        panel.setActiveView("output");

        expect(actions.getRoot()).toBe(body);
        expect(validateTree(body)).toEqual([]);
    });
});
