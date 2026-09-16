import { describe, expect, it } from "vitest";

import type { IDisposable } from "@tuidom/core/common/disposable";
import { Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import type { MruCycleState } from "../../../services/editor/browser/editorGroupModel.ts";
import type { IEditorPane } from "./iEditorPane.ts";

import { TabSwitcherComponent } from "./tabSwitcherComponent.ts";

// Полный маршрут «событие модели → overlay-сессия → кадр» закрывает
// workbench.tabSwitcher.test.ts; здесь — жизнь компонента ДО attachHost
// (события в headless-порядке не должны ни падать, ни открывать сессию).

function makePane(label: string): IEditorPane {
    return {
        uri: Uri.file(`/${label}`),
        label,
        view: {} as TUIElement,
        isModified: false,
        readOnly: false,
        getSelectedTexts: () => [],
        onDidChangeState: (): IDisposable => ({ dispose: () => {} }),
        focusEditor() {},
        dispose() {},
    };
}

function stubEditorService(): {
    service: EditorService;
    fireCycle: (state: MruCycleState | null) => void;
    fireActiveGroup: () => void;
} {
    let cycleListener: ((state: MruCycleState | null) => void) | null = null;
    let groupListener: (() => void) | null = null;
    const service = {
        onDidChangeMruCycle(cb: (state: MruCycleState | null) => void): IDisposable {
            cycleListener = cb;
            return { dispose: () => {} };
        },
        onDidActiveGroupChange(cb: () => void): IDisposable {
            groupListener = cb;
            return { dispose: () => {} };
        },
        displayName: (pane: IEditorPane) => pane.label,
    } as unknown as EditorService;
    return {
        service,
        fireCycle: (state) => cycleListener?.(state),
        fireActiveGroup: () => groupListener?.(),
    };
}

describe("TabSwitcherComponent — без прикреплённого хоста", () => {
    it("события серии до attachHost не открывают сессию и не падают", () => {
        const { service, fireCycle, fireActiveGroup } = stubEditorService();
        const component = new TabSwitcherComponent(service);

        expect(component.isOpen()).toBe(false);
        // Стабильный e2e-селектор оверлея (как editorGroup-<id> у групп).
        expect(component.view.id).toBe("tabSwitcher");

        fireCycle({ panes: [makePane("a.ts"), makePane("b.ts")], pointer: 1 });
        expect(component.isOpen()).toBe(false);
        // Список тем не менее отражает состояние — сессии просто некуда открыться.
        expect(component.view.inspectState()).toMatchObject({ items: ["a.ts", "b.ts"], currentIndex: 1 });

        fireCycle(null);
        fireActiveGroup();
        expect(component.isOpen()).toBe(false);

        component.dispose();
    });
});

describe("TabSwitcherComponent — overlay-сессия", () => {
    function withHost() {
        const { service, fireCycle, fireActiveGroup } = stubEditorService();
        const component = new TabSwitcherComponent(service);
        const body = new BodyElement();
        const testApp = TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        testApp.render();
        return { component, body, testApp, fireCycle, fireActiveGroup };
    }

    const cycle = (pointer: number) => ({ panes: [makePane("a.ts"), makePane("b.ts")], pointer });

    it("шаг серии открывает сессию, конец серии её закрывает", () => {
        const { component, fireCycle } = withHost();

        fireCycle(cycle(1));
        expect(component.isOpen()).toBe(true);

        fireCycle(null);
        expect(component.isOpen()).toBe(false);

        component.dispose();
    });

    it("смена активной группы гасит открытый список", () => {
        const { component, fireCycle, fireActiveGroup } = withHost();

        fireCycle(cycle(1));
        expect(component.isOpen()).toBe(true);

        fireActiveGroup();

        expect(component.isOpen()).toBe(false);
        component.dispose();
    });

    it("dispose снимает сессию со слоя — оверлей не переживает компонент", () => {
        const { component, body, fireCycle } = withHost();
        fireCycle(cycle(0));
        expect(body.overlayLayer.getItems().some((item) => item.element === component.view)).toBe(true);

        component.dispose();

        expect(body.overlayLayer.getItems().some((item) => item.element === component.view)).toBe(false);
        expect(component.isOpen()).toBe(false);
    });
});
