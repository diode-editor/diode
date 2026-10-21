import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";

import type { TextEditorPane } from "./textEditorPane.ts";

/** Подмножество upstream `CodeEditorStateFlag`: `Selection`/`Scroll` нашим потребителям не нужны. */
export enum EditorStateFlag {
    Value = 1,
    Position = 2,
}

export type IEditorStateSource = Pick<TextEditorPane, "onDidChangeContent" | "onDidChangeCursorPosition">;

/**
 * Аналог upstream `EditorStateCancellationTokenSource`: ответ, пришедший после того,
 * как человек ушёл печатать, не применяется (переход к определению не уносит каретку
 * задним числом).
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
