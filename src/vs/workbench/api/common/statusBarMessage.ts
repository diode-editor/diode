import type * as vscode from "vscode";

import { DisposableImpl } from "./vscodeTypes.ts";

/**
 * Upstream's `StatusBarMessage`: one item shared by all extensions, messages form a stack.
 * The item is created on the first message.
 */
export function createStatusBarMessage(
    createItem: () => vscode.StatusBarItem,
): typeof vscode.window.setStatusBarMessage {
    let item: vscode.StatusBarItem | undefined;
    // Objects, not strings: two identical texts are two distinct messages.
    const messages: { readonly text: string }[] = [];

    const update = (): void => {
        if (item === undefined) {
            item = createItem();
            item.name = "Extension Status";
        }
        const top = messages.at(0);
        if (top === undefined) {
            item.hide();
            return;
        }
        item.text = top.text;
        item.show();
    };

    const setMessage = (text: string): vscode.Disposable => {
        const entry = { text };
        messages.unshift(entry);
        update();
        return new DisposableImpl(() => {
            const index = messages.indexOf(entry);
            if (index < 0) return;
            messages.splice(index, 1);
            update();
        });
    };

    return (text: string, hideAfterTimeoutOrWhenDone?: number | Thenable<unknown>): vscode.Disposable => {
        const message = setMessage(text);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const hide = (): void => {
            message.dispose();
        };
        if (typeof hideAfterTimeoutOrWhenDone === "number") {
            timer = setTimeout(hide, hideAfterTimeoutOrWhenDone);
        } else if (hideAfterTimeoutOrWhenDone !== undefined) {
            hideAfterTimeoutOrWhenDone.then(hide, hide);
        }
        return new DisposableImpl(() => {
            message.dispose();
            clearTimeout(timer);
        });
    };
}
