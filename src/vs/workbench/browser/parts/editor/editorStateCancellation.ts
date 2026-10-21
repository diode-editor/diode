import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";

import type { TextEditorPane } from "./textEditorPane.ts";

/** Subset of upstream `CodeEditorStateFlag`: our consumers don't need `Selection`/`Scroll`. */
export enum EditorStateFlag {
    Value = 1,
    Position = 2,
}

export type IEditorStateSource = Pick<TextEditorPane, "onDidChangeContent" | "onDidChangeCursorPosition">;

/**
 * Counterpart of upstream `EditorStateCancellationTokenSource`: a response that arrives after the
 * user has moved on to typing is not applied (go to definition does not yank the cursor away
 * after the fact).
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
