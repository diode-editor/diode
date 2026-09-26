import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { type CursorChangeSource, withCursorChangeSource } from "../../../editor/common/core/cursorChangeSource.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";
import type { IActiveEditorSelections } from "../common/iEditorOptionsService.ts";

import { EditorOptionsServiceAdapter } from "./editorOptionsServiceAdapter.ts";

// Продюсер поля `kind` у `editor.selectionChanged` — «кто и по какому жесту его
// шлёт». Источник снимается СИНХРОННО в обработчике, а нотификация уезжает
// отложенно (коалесинг в тик): без синхронного снятия `kind` был бы всегда
// undefined, а событие расширения — без вида.

/**
 * Группа с одним живым редактором: присваивание `viewState.selections` фаерит
 * подписчиков `onDidChangeActiveEditorSelection`, как настоящий EditorService.
 */
function liveGroup(): { group: EditorService; move: (character: number) => void } {
    const listeners: (() => void)[] = [];
    let current: unknown[] = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }];
    const editor = {
        uri: Uri.file("/a/b.ts"),
        model: { document: { lineCount: 10, getLineLength: () => 20 } },
        focusEditor: vi.fn(),
        viewState: {
            get selections(): unknown[] {
                return current;
            },
            set selections(v: unknown[]) {
                current = v;
                for (const cb of [...listeners]) cb();
            },
        },
    };
    const group = {
        groupOf: () => ({ id: 1 }),
        activeGroup: { id: 1 },
        viewColumnOf: () => 1,
        groups: [] as unknown[],
        getEditors: () => [] as unknown[],
        getActiveTabEditor: () => editor,
        onDidChangeActiveEditorSelection: (cb: (e: unknown) => void) => {
            const wrapped = (): void => {
                cb(editor);
            };
            listeners.push(wrapped);
            return {
                dispose: () => {
                    listeners.splice(listeners.indexOf(wrapped), 1);
                },
            };
        },
    } as unknown as EditorService;
    return {
        group,
        move: (character) => {
            editor.viewState.selections = [{ anchor: { line: 0, character }, active: { line: 0, character } }] as never;
        },
    };
}

/** Двигает каретку внутри объявленного источника и возвращает то, что уехало. */
async function notifiedFor(source: CursorChangeSource | undefined): Promise<IActiveEditorSelections> {
    const { group, move } = liveGroup();
    const adapter = new EditorOptionsServiceAdapter(group);
    const seen: IActiveEditorSelections[] = [];
    adapter.onActiveEditorSelectionChanged((s) => seen.push(s));
    if (source === undefined) move(3);
    else
        withCursorChangeSource(source, () => {
            move(3);
        });
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    return seen[0];
}

describe("EditorOptionsServiceAdapter — kind в editor.selectionChanged", () => {
    it("жест клавиатуры уезжает как kind 1", async () => {
        expect((await notifiedFor("keyboard")).kind).toBe(1);
    });

    it("жест мыши уезжает как kind 2", async () => {
        expect((await notifiedFor("mouse")).kind).toBe(2);
    });

    it("команда уезжает как kind 3", async () => {
        expect((await notifiedFor("command")).kind).toBe(3);
    });

    it("неразмеченный жест (undo, find) едет вовсе без поля kind", async () => {
        const payload = await notifiedFor(undefined);
        expect(payload.kind).toBeUndefined();
        expect("kind" in payload).toBe(false);
    });

    it("источник снимается синхронно: к моменту отложенного флаша область уже закрыта", async () => {
        const { group, move } = liveGroup();
        const adapter = new EditorOptionsServiceAdapter(group);
        const seen: IActiveEditorSelections[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        withCursorChangeSource("mouse", () => {
            move(2);
        });
        // Область закрыта прямо здесь — нотификация ещё не ушла.
        expect(seen).toHaveLength(0);
        await Promise.resolve();
        expect(seen[0]?.kind).toBe(2);
    });

    it("в коалесенном тике побеждает ПОСЛЕДНИЙ источник — он же автор итоговых выделений", async () => {
        const { group, move } = liveGroup();
        const adapter = new EditorOptionsServiceAdapter(group);
        const seen: IActiveEditorSelections[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        withCursorChangeSource("keyboard", () => {
            move(2);
        });
        withCursorChangeSource("mouse", () => {
            move(5);
        });
        await Promise.resolve();

        expect(seen).toHaveLength(1);
        expect(seen[0].kind).toBe(2);
        expect(seen[0].selections[0].activeCharacter).toBe(5);
    });

    it("источник не протекает в следующий тик", async () => {
        const { group, move } = liveGroup();
        const adapter = new EditorOptionsServiceAdapter(group);
        const seen: IActiveEditorSelections[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        withCursorChangeSource("mouse", () => {
            move(1);
        });
        await Promise.resolve();
        move(4);
        await Promise.resolve();

        expect(seen.map((s) => s.kind)).toEqual([2, undefined]);
    });
});
