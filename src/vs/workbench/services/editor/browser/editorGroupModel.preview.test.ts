import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

import { EditorGroup } from "./editorGroupModel.ts";

/**
 * Фейковая вкладка с управляемым `isModified` — предпросмотр весь про него:
 * «первая правка прикалывает» и «грязную не замещаем».
 */
interface IFakePane extends IEditorPane {
    disposed: boolean;
    isModified: boolean;
    fireStateChange(): void;
}

function makePane(uriPath: string, modified = false): IFakePane {
    const stateListeners: (() => void)[] = [];
    const pane: IFakePane = {
        uri: Uri.file(uriPath),
        label: uriPath,
        view: {} as TUIElement,
        isModified: modified,
        readOnly: false,
        disposed: false,
        getSelectedTexts: () => [],
        onDidChangeState(cb: () => void): IDisposable {
            stateListeners.push(cb);
            return {
                dispose: () => {
                    const i = stateListeners.indexOf(cb);
                    if (i >= 0) stateListeners.splice(i, 1);
                },
            };
        },
        focusEditor() {},
        dispose() {
            pane.disposed = true;
        },
        fireStateChange() {
            for (const cb of [...stateListeners]) cb();
        },
    };
    return pane;
}

describe("EditorGroup — вкладка-предпросмотр", () => {
    it("по умолчанию вкладка приколота, предпросмотра у группы нет", () => {
        const group = new EditorGroup(1);
        const pane = makePane("/a.ts");
        group.insertPane(pane);

        expect(group.previewPane).toBe(null);
        expect(group.isPinned(pane)).toBe(true);
    });

    it("insertPane с preview помечает вкладку предпросмотром", () => {
        const group = new EditorGroup(1);
        const pane = makePane("/a.ts");
        group.insertPane(pane, { preview: true });

        expect(group.previewPane === pane).toBe(true);
        expect(group.isPinned(pane)).toBe(false);
    });

    it("pinPane снимает предпросмотр и будит перерисовку табов", () => {
        const group = new EditorGroup(1);
        const pane = makePane("/a.ts");
        group.insertPane(pane, { preview: true });
        let fired = 0;
        group.onDidChangeEditors(() => fired++);

        group.pinPane(pane);

        expect(group.previewPane).toBe(null);
        expect(group.isPinned(pane)).toBe(true);
        expect(fired).toBe(1);
    });

    it("pinPane на уже приколотой вкладке — no-op без события", () => {
        const group = new EditorGroup(1);
        const preview = makePane("/a.ts");
        const pinned = makePane("/b.ts");
        group.insertPane(preview, { preview: true });
        group.insertPane(pinned);
        let fired = 0;
        group.onDidChangeEditors(() => fired++);

        group.pinPane(pinned);

        expect(fired).toBe(0);
        // Чужое прикалывание не сняло предпросмотр с настоящей превью-вкладки.
        expect(group.previewPane === preview).toBe(true);
    });

    it("первая правка прикалывает вкладку-предпросмотр", () => {
        const group = new EditorGroup(1);
        const pane = makePane("/a.ts");
        group.insertPane(pane, { preview: true });

        pane.isModified = true;
        pane.fireStateChange();

        expect(group.previewPane).toBe(null);
        expect(group.isPinned(pane)).toBe(true);
    });

    it("защёлка: возврат к сохранённой версии не делает вкладку предпросмотром снова", () => {
        const group = new EditorGroup(1);
        const pane = makePane("/a.ts");
        group.insertPane(pane, { preview: true });

        pane.isModified = true;
        pane.fireStateChange();
        // Undo до сохранённой версии: буфер снова чистый.
        pane.isModified = false;
        pane.fireStateChange();

        expect(group.isPinned(pane)).toBe(true);
    });

    it("смена состояния чистой вкладки предпросмотр не снимает", () => {
        const group = new EditorGroup(1);
        const pane = makePane("/a.ts");
        group.insertPane(pane, { preview: true });
        let fired = 0;
        group.onDidChangeEditors(() => fired++);

        // Сохранение, смена кодировки, read-only — всё это onDidChangeState без правки.
        pane.fireStateChange();

        expect(group.previewPane === pane).toBe(true);
        expect(fired).toBe(1);
    });

    it("вкладка, приехавшая уже грязной, предпросмотром не становится", () => {
        const group = new EditorGroup(1);
        // Дубль документа при сплите: у копии isModified true с рождения, и
        // ждать от неё смены состояния нечего.
        const pane = makePane("/a.ts", true);
        group.insertPane(pane, { preview: true });

        pane.fireStateChange();

        expect(group.isPinned(pane)).toBe(true);
    });

    it("replacePane занимает слот старой вкладки и диспозит её", () => {
        const group = new EditorGroup(1);
        const pinned = makePane("/pinned.ts");
        const preview = makePane("/a.ts");
        group.insertPane(pinned);
        group.insertPane(preview, { preview: true });
        group.activateTab(1);

        const next = makePane("/b.ts");
        group.replacePane(1, next, { preview: true });

        expect(group.getPanes().map((p) => p.label)).toEqual(["/pinned.ts", "/b.ts"]);
        expect(preview.disposed).toBe(true);
        expect(group.previewPane === next).toBe(true);
        // Индекс активной вкладки не поехал — слот тот же.
        expect(group.activeIndex).toBe(1);
    });

    it("replacePane не шлёт событий сам — перерисовку делает activateTab", () => {
        const group = new EditorGroup(1);
        const preview = makePane("/a.ts");
        group.insertPane(preview, { preview: true });
        let fired = 0;
        group.onDidChangeEditors(() => fired++);

        group.replacePane(0, makePane("/b.ts"), { preview: true });

        expect(fired).toBe(0);
    });

    it("замещённая вкладка больше не будит группу своими событиями", () => {
        const group = new EditorGroup(1);
        const preview = makePane("/a.ts");
        group.insertPane(preview, { preview: true });
        group.replacePane(0, makePane("/b.ts"), { preview: true });
        let fired = 0;
        group.onDidChangeEditors(() => fired++);

        preview.isModified = true;
        preview.fireStateChange();

        expect(fired).toBe(0);
        // Правка в уже замещённой вкладке не снимает предпросмотр с новой.
        expect(group.previewPane?.label).toBe("/b.ts");
    });

    it.each([
        ["далеко за полосой", 5],
        ["ровно на длину полосы", 1],
        ["отрицательный", -1],
    ])("replacePane вне границ (%s) — no-op, без броска", (_случай, index) => {
        const group = new EditorGroup(1);
        const preview = makePane("/a.ts");
        group.insertPane(preview, { preview: true });

        // Обе границы проверяем по отдельности: `index === panes.length` и
        // `index === -1` — ровно те точки, на которых промахивается сравнение
        // «не тем знаком» и потерянная половина условия.
        expect(() => {
            group.replacePane(index, makePane("/b.ts"));
        }).not.toThrow();

        expect(group.getPanes().map((p) => p.label)).toEqual(["/a.ts"]);
        expect(group.previewPane === preview).toBe(true);
    });

    it("замещение вкладки вне MRU-стека чужой стек не трогает", () => {
        const group = new EditorGroup(1);
        const pinned = makePane("/pinned.ts");
        const preview = makePane("/a.ts");
        group.insertPane(pinned);
        group.activateTab(0);
        // Превью вставлена, но НЕ активировалась — в стеке MRU её нет.
        group.insertPane(preview, { preview: true });
        expect(group.getMruOrder().map((p) => p.label)).toEqual(["/pinned.ts"]);

        group.replacePane(1, makePane("/b.ts"), { preview: true });

        // Вычёркивать из стека нечего; снять «последнего» вместо ненайденного
        // значило бы выбросить из MRU приколотую соседку.
        expect(group.getMruOrder().map((p) => p.label)).toEqual(["/pinned.ts"]);
    });

    it("закрытие ЧУЖОЙ вкладки предпросмотр группы не снимает", () => {
        const group = new EditorGroup(1);
        const pinned = makePane("/pinned.ts");
        const preview = makePane("/a.ts");
        group.insertPane(pinned);
        group.insertPane(preview, { preview: true });

        group.closeTab(0);

        expect(group.previewPane === preview).toBe(true);
    });

    it("правка ЧУЖОЙ вкладки предпросмотр группы не снимает", () => {
        const group = new EditorGroup(1);
        const preview = makePane("/a.ts");
        const other = makePane("/other.ts");
        group.insertPane(preview, { preview: true });
        group.insertPane(other);

        other.isModified = true;
        other.fireStateChange();

        // Прикалывает ТА вкладка, которую правят, а не любая правка в группе.
        expect(group.previewPane === preview).toBe(true);
    });

    it("вставка ПОСЛЕ активной её индекс не двигает, вставка НА её место — двигает", () => {
        const group = new EditorGroup(1);
        group.insertPane(makePane("/a.ts"));
        group.insertPane(makePane("/b.ts"));
        group.activateTab(0);

        // Вставка правее активной: индекс активной прежний.
        group.insertPane(makePane("/after.ts"), { index: 1 });
        expect(group.activeIndex).toBe(0);

        // Вставка РОВНО на позицию активной сдвигает её вправо.
        group.insertPane(makePane("/onto.ts"), { index: 0 });
        expect(group.activeIndex).toBe(1);
    });

    it("replacePane без preview даёт приколотую вкладку на месте превью", () => {
        const group = new EditorGroup(1);
        group.insertPane(makePane("/a.ts"), { preview: true });

        const next = makePane("/b.ts");
        group.replacePane(0, next);

        expect(group.previewPane).toBe(null);
        expect(group.isPinned(next)).toBe(true);
    });

    it("закрытие превью-вкладки снимает предпросмотр с группы", () => {
        const group = new EditorGroup(1);
        group.insertPane(makePane("/a.ts"), { preview: true });

        group.closeTab(0);

        expect(group.previewPane).toBe(null);
    });

    it("перенос превью-вкладки в другую группу прикалывает её", () => {
        const source = new EditorGroup(1);
        const target = new EditorGroup(2);
        const pane = makePane("/a.ts");
        source.insertPane(pane, { preview: true });

        const detached = source.detachPane(0);
        expect(detached === pane).toBe(true);
        target.insertPane(pane);

        expect(source.previewPane).toBe(null);
        expect(target.previewPane).toBe(null);
        expect(target.isPinned(pane)).toBe(true);
    });

    it("dispose группы гасит предпросмотр", () => {
        const group = new EditorGroup(1);
        group.insertPane(makePane("/a.ts"), { preview: true });

        group.dispose();

        expect(group.previewPane).toBe(null);
    });

    it("замещение гасит серию Ctrl+Tab: замороженный список стал невалидным", () => {
        const group = new EditorGroup(1);
        const first = makePane("/a.ts");
        const second = makePane("/b.ts");
        group.insertPane(first);
        group.insertPane(second, { preview: true });
        group.activateTab(0);
        group.activateTab(1);

        const cycleStates: unknown[] = [];
        group.onDidChangeMruCycle((state) => cycleStates.push(state));
        group.cycleMru(1);
        expect(cycleStates.at(-1)).not.toBe(null);

        group.replacePane(1, makePane("/c.ts"), { preview: true });

        // Серия кончилась: оверлей переключателя обязан погаснуть, иначе он
        // остался бы показывать вкладку, которой в полосе уже нет.
        expect(cycleStates.at(-1)).toBe(null);
    });

    it("замещение правит MRU: старая вкладка уходит из стека, новая активируется", () => {
        const group = new EditorGroup(1);
        const pinned = makePane("/pinned.ts");
        const preview = makePane("/a.ts");
        group.insertPane(pinned);
        group.insertPane(preview, { preview: true });
        group.activateTab(0);
        group.activateTab(1);
        expect(group.getMruOrder().map((p) => p.label)).toEqual(["/a.ts", "/pinned.ts"]);

        const next = makePane("/b.ts");
        group.replacePane(1, next, { preview: true });
        group.activateTab(1);

        expect(group.getMruOrder().map((p) => p.label)).toEqual(["/b.ts", "/pinned.ts"]);
    });
});
