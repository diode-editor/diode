import { describe, expect, it } from "vitest";

import type { IDisposable } from "@tuidom/all/common/disposable";
import type { TUIElement } from "@tuidom/all/dom/tuiElement";
import { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

import { EditorGroup } from "./editorGroupModel.ts";

/** Минимальная фейковая вкладка: события состояния + следы dispose/focus. */
interface IFakePane extends IEditorPane {
    disposed: boolean;
    focused: number;
    fireStateChange(): void;
}

function makePane(uriPath: string): IFakePane {
    const stateListeners: (() => void)[] = [];
    const pane: IFakePane = {
        uri: Uri.file(uriPath),
        label: uriPath,
        view: {} as TUIElement,
        isModified: false,
        readOnly: false,
        disposed: false,
        focused: 0,
        getSelectedText: () => "",
        onDidChangeState(cb: () => void): IDisposable {
            stateListeners.push(cb);
            return {
                dispose: () => {
                    const i = stateListeners.indexOf(cb);
                    if (i >= 0) stateListeners.splice(i, 1);
                },
            };
        },
        focusEditor() {
            pane.focused++;
        },
        dispose() {
            pane.disposed = true;
        },
        fireStateChange() {
            for (const cb of [...stateListeners]) cb();
        },
    };
    return pane;
}

function groupWith(...paths: string[]): { group: EditorGroup; panes: IFakePane[] } {
    const group = new EditorGroup(1);
    const panes = paths.map((p) => makePane(p));
    for (const pane of panes) group.insertPane(pane);
    return { group, panes };
}

describe("EditorGroup", () => {
    it("контракт порядка событий activateTab: onDidChangeEditors → фокус → onDidChangeActivePane", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts");
        const order: string[] = [];
        group.onDidChangeEditors(() => order.push("editors"));
        group.onDidChangeActivePane(() => order.push("active"));
        panes[1].focusEditor = () => order.push("focus");

        group.activateTab(1);

        expect(order).toEqual(["editors", "focus", "active"]);
    });

    it("activateTab без focus не фокусирует, но события те же", () => {
        const { group, panes } = groupWith("/a.ts");
        group.activateTab(0, { focus: false });
        expect(panes[0].focused).toBe(0);
        expect(group.activePane === panes[0]).toBe(true);
    });

    it("insertPane до активной сдвигает activeIndex, активная вкладка та же", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts");
        group.activateTab(1);
        const inserted = makePane("/c.ts");

        group.insertPane(inserted, { index: 0 });

        expect(group.activeIndex).toBe(2);
        expect(group.activePane === panes[1]).toBe(true);
        expect(group.getPanes()[0] === inserted).toBe(true);
    });

    it("closeTab активной: активной становится соседняя слева, вкладка disposed", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.activateTab(1);

        group.closeTab(1);

        expect(panes[1].disposed).toBe(true);
        expect(group.activePane === panes[0]).toBe(true);
        expect(group.editorCount).toBe(2);
    });

    it("closeTab последней вкладки: activePane == null, событие с null", () => {
        const { group, panes } = groupWith("/a.ts");
        group.activateTab(0);
        let observed: IEditorPane | null | undefined;
        group.onDidChangeActivePane((pane) => {
            observed = pane;
        });

        group.closeTab(0);

        expect(panes[0].disposed).toBe(true);
        expect(group.activePane).toBeNull();
        expect(observed).toBeNull();
        expect(group.activeIndex).toBe(-1);
    });

    it("closeTab после активной: активная не меняется, только перерисовка табов", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts");
        group.activateTab(0);
        let editorsFired = 0;
        let activeFired = 0;
        group.onDidChangeEditors(() => editorsFired++);
        group.onDidChangeActivePane(() => activeFired++);

        group.closeTab(1);

        expect(editorsFired).toBe(1);
        expect(activeFired).toBe(0);
        expect(group.activePane === panes[0]).toBe(true);
    });

    it("detachPane снимает вкладку живой и отписывается от её состояния", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts");
        group.activateTab(1);
        let editorsFired = 0;
        group.onDidChangeEditors(() => editorsFired++);

        const detached = group.detachPane(1);

        expect(detached === panes[1]).toBe(true);
        expect(panes[1].disposed).toBe(false);
        expect(group.editorCount).toBe(1);
        // Снятая вкладка больше не дёргает перерисовку этой группы.
        const before = editorsFired;
        panes[1].fireStateChange();
        expect(editorsFired).toBe(before);
    });

    it("detachPane с невалидным индексом — null, группа не тронута", () => {
        const { group } = groupWith("/a.ts");
        expect(group.detachPane(-1)).toBeNull();
        expect(group.detachPane(1)).toBeNull();
        expect(group.editorCount).toBe(1);
    });

    it("изменение состояния вкладки перерисовывает табы группы", () => {
        const { group, panes } = groupWith("/a.ts");
        let editorsFired = 0;
        group.onDidChangeEditors(() => editorsFired++);

        panes[0].fireStateChange();

        expect(editorsFired).toBe(1);
    });

    it("findPaneIndex — пер-группный дедуп по ресурсу", () => {
        const { group } = groupWith("/a.ts", "/b.ts");
        expect(group.findPaneIndex(Uri.file("/b.ts"))).toBe(1);
        expect(group.findPaneIndex(Uri.file("/nope.ts"))).toBe(-1);
    });

    it("dispose группы диспозит оставшиеся вкладки", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts");
        group.dispose();
        expect(panes[0].disposed).toBe(true);
        expect(panes[1].disposed).toBe(true);
    });

    it("повторный dispose подписок группы — no-op, чужие слушатели живы", () => {
        const { group } = groupWith("/a.ts", "/b.ts");
        let editorsFired = 0;
        let paneFired = 0;
        const editorsFirst = group.onDidChangeEditors(() => {});
        group.onDidChangeEditors(() => editorsFired++);
        const paneFirst = group.onDidChangeActivePane(() => {});
        group.onDidChangeActivePane(() => paneFired++);

        editorsFirst.dispose();
        editorsFirst.dispose(); // indexOf === -1 — второй слушатель не снят
        paneFirst.dispose();
        paneFirst.dispose();

        group.activateTab(1);
        expect(editorsFired).toBe(1);
        expect(paneFired).toBe(1);
    });

    it("MRU: серия заморожена, endMruCycle коммитит выбор", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.activateTab(0);
        group.activateTab(1);
        group.activateTab(2);
        // MRU: c, b, a. Один шаг серии уходит к b.
        group.cycleMru(1);
        expect(group.activePane === panes[1]).toBe(true);
        // Второй шаг той же серии идёт глубже — к a (список заморожен).
        group.cycleMru(1);
        expect(group.activePane === panes[0]).toBe(true);
        group.endMruCycle();
        expect(group.getMruOrder()[0] === panes[0]).toBe(true);
    });
});
