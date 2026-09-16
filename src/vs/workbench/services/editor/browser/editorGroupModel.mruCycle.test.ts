import { describe, expect, it } from "vitest";

import type { IDisposable } from "@tuidom/core/common/disposable";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

import { EditorGroup, type MruCycleState } from "./editorGroupModel.ts";

function makePane(uriPath: string): IEditorPane {
    const pane: IEditorPane = {
        uri: Uri.file(uriPath),
        label: uriPath,
        view: {} as TUIElement,
        isModified: false,
        readOnly: false,
        getSelectedTexts: () => [],
        onDidChangeState(): IDisposable {
            return { dispose: () => {} };
        },
        focusEditor() {},
        dispose() {},
    };
    return pane;
}

function groupWith(...paths: string[]): { group: EditorGroup; events: (MruCycleState | null)[] } {
    const group = new EditorGroup(1);
    // Как openFile: вставка + активация каждой — MRU наполняется активациями.
    for (const [index, path] of paths.entries()) {
        group.insertPane(makePane(path));
        group.activateTab(index);
    }
    const events: (MruCycleState | null)[] = [];
    group.onDidChangeMruCycle((state) => events.push(state));
    return { group, events };
}

function names(state: MruCycleState | null): string[] {
    return (state?.panes ?? []).map((pane) => pane.label);
}

describe("EditorGroup — событие серии Ctrl+Tab (onDidChangeMruCycle)", () => {
    it("каждый шаг cycleMru шлёт замороженный MRU-список и позицию цикла", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        // MRU после активации c: c, b, a.
        group.cycleMru(1);

        expect(events).toHaveLength(1);
        expect(names(events[0])).toEqual(["/c.ts", "/b.ts", "/a.ts"]);
        expect(events[0]?.pointer).toBe(1);

        group.cycleMru(1);
        expect(events).toHaveLength(2);
        // Список тот же (заморожен), позиция уехала глубже.
        expect(names(events[1])).toEqual(["/c.ts", "/b.ts", "/a.ts"]);
        expect(events[1]?.pointer).toBe(2);
    });

    it("шаг назад двигает позицию с заворотом по замороженному списку", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.cycleMru(-1);
        expect(events[0]?.pointer).toBe(2);
    });

    it("endMruCycle (отпускание Ctrl) шлёт null — оверлей гаснет", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts");
        group.cycleMru(1);
        group.endMruCycle();
        expect(events).toEqual([expect.objectContaining({ pointer: 1 }), null]);
    });

    it("обычное переключение вкладки во время серии шлёт null", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.cycleMru(1);
        group.activateTab(0);
        expect(events[events.length - 1]).toBeNull();
    });

    it("закрытие вкладки во время серии шлёт null (замороженный список невалиден)", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.cycleMru(1);
        group.closeTab(0);
        expect(events[events.length - 1]).toBeNull();
    });

    it("структурные изменения БЕЗ идущей серии подписчиков не будят", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.closeTab(0);
        group.activateTab(0);
        expect(events).toEqual([]);
    });

    it("endMruCycle вне серии — no-op без события", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts");
        group.endMruCycle();
        expect(events).toEqual([]);
    });

    it("отписка снимает листенер", () => {
        const group = new EditorGroup(1);
        for (const [index, path] of ["/a.ts", "/b.ts"].entries()) {
            group.insertPane(makePane(path));
            group.activateTab(index);
        }
        const events: (MruCycleState | null)[] = [];
        const others: (MruCycleState | null)[] = [];
        const subscription = group.onDidChangeMruCycle((state) => events.push(state));
        group.onDidChangeMruCycle((state) => others.push(state));
        subscription.dispose();
        // Повторный dispose безвреден и НЕ трогает чужие подписки.
        subscription.dispose();
        group.cycleMru(1);
        expect(events).toEqual([]);
        expect(others).toHaveLength(1);
    });

    it("снимок в событии — копия: мутации серии его не меняют", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.cycleMru(1);
        const first = events[0];
        group.cycleMru(1);
        // Первый снимок остался на своей позиции — оверлей может держать его как есть.
        expect(first?.pointer).toBe(1);
        expect(events[1]?.pointer).toBe(2);
    });
});
