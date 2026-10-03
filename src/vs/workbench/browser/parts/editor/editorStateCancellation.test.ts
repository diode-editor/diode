import { describe, expect, it } from "vitest";

import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";

import type { IEditorStateSource } from "./editorStateCancellation.ts";
import { EditorStateCancellationTokenSource, EditorStateFlag } from "./editorStateCancellation.ts";

/** Панель-заглушка: события правки и каретки дёргаются руками. */
function fakeEditor(): IEditorStateSource & {
    edit: () => void;
    moveCaret: () => void;
    readonly subscribers: number;
} {
    const content = new Set<() => void>();
    const caret = new Set<() => void>();
    const subscribe =
        (set: Set<() => void>) =>
        (listener: () => void): IDisposable => {
            set.add(listener);
            return { dispose: () => set.delete(listener) };
        };
    return {
        onDidChangeContent: subscribe(content),
        onDidChangeCursorPosition: subscribe(caret),
        edit: () => {
            for (const listener of [...content]) listener();
        },
        moveCaret: () => {
            for (const listener of [...caret]) listener();
        },
        get subscribers() {
            return content.size + caret.size;
        },
    };
}

describe("EditorStateCancellationTokenSource", () => {
    it("Value: правка отменяет, движение каретки — нет", () => {
        const editor = fakeEditor();
        const source = new EditorStateCancellationTokenSource(editor, EditorStateFlag.Value);

        editor.moveCaret();
        expect(source.token.isCancellationRequested).toBe(false);

        editor.edit();
        expect(source.token.isCancellationRequested).toBe(true);
    });

    it("Position: движение каретки отменяет, правка — нет", () => {
        const editor = fakeEditor();
        const source = new EditorStateCancellationTokenSource(editor, EditorStateFlag.Position);

        editor.edit();
        expect(source.token.isCancellationRequested).toBe(false);

        editor.moveCaret();
        expect(source.token.isCancellationRequested).toBe(true);
    });

    it("Value | Position: отменяет любое из двух", () => {
        const flags = EditorStateFlag.Value | EditorStateFlag.Position;
        const byEdit = fakeEditor();
        const editSource = new EditorStateCancellationTokenSource(byEdit, flags);
        byEdit.edit();
        expect(editSource.token.isCancellationRequested).toBe(true);

        const byCaret = fakeEditor();
        const caretSource = new EditorStateCancellationTokenSource(byCaret, flags);
        byCaret.moveCaret();
        expect(caretSource.token.isCancellationRequested).toBe(true);
    });

    it("отмена родителя отменяет источник", () => {
        const parent = new CancellationTokenSource();
        const source = new EditorStateCancellationTokenSource(fakeEditor(), EditorStateFlag.Value, parent.token);

        parent.cancel();

        expect(source.token.isCancellationRequested).toBe(true);
    });

    it("dispose снимает подписки на редактор и не отменяет", () => {
        const editor = fakeEditor();
        const source = new EditorStateCancellationTokenSource(editor, EditorStateFlag.Value | EditorStateFlag.Position);
        expect(editor.subscribers).toBe(2);

        source.dispose();

        expect(editor.subscribers).toBe(0);
        expect(source.token.isCancellationRequested).toBe(false);
    });

    it("dispose снимает и подписку на родителя", () => {
        const parent = new CancellationTokenSource();
        const source = new EditorStateCancellationTokenSource(fakeEditor(), EditorStateFlag.Value, parent.token);

        source.dispose();
        parent.cancel();

        expect(source.token.isCancellationRequested).toBe(false);
    });
});
