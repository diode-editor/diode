import type { IDisposable } from "@tuidom/core/common/disposable";

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";

import type { TextEditorPane } from "./textEditorPane.ts";

/**
 * Что в редакторе делает запрос устаревшим — подмножество upstream
 * `CodeEditorStateFlag` (`editor/contrib/editorState/browser/editorState.ts`):
 * без `Selection`/`Scroll`, их нашим потребителям не нужно.
 */
export enum EditorStateFlag {
    /** Правка документа. */
    Value = 1,
    /** Движение каретки. */
    Position = 2,
}

/** Часть панели, на которую смотрит источник: только события. */
export type IEditorStateSource = Pick<TextEditorPane, "onDidChangeContent" | "onDidChangeCursorPosition">;

/**
 * Токен «пока редактор в том же состоянии» — аналог upstream
 * `EditorStateCancellationTokenSource`: отменяется на правку документа
 * ({@link EditorStateFlag.Value}) и/или движение каретки
 * ({@link EditorStateFlag.Position}). Ответ, пришедший после того, как
 * человек ушёл печатать или двигать каретку, уже не применяется — так, например,
 * переход к определению не уносит его задним числом. Подписки на редактор
 * снимает `dispose()`.
 */
export class EditorStateCancellationTokenSource extends CancellationTokenSource {
    private readonly subscriptions: IDisposable[] = [];

    public constructor(editor: IEditorStateSource, flags: EditorStateFlag, parent?: ICancellationToken) {
        super(parent);
        const cancel = (): void => {
            this.cancel();
        };
        if (flags & EditorStateFlag.Value) this.subscriptions.push(editor.onDidChangeContent(cancel));
        if (flags & EditorStateFlag.Position) this.subscriptions.push(editor.onDidChangeCursorPosition(cancel));
    }

    public override dispose(): void {
        for (const subscription of this.subscriptions) subscription.dispose();
        this.subscriptions.length = 0;
        super.dispose();
    }
}
