/**
 * Gesture source for `TextEditorSelectionChangeKind`. Not a parameter threaded through five
 * signatures but a **synchronous scope** around the gesture handler: the chain from the
 * gesture to the selection change listener is synchronous. A cursor change after `await`
 * falls outside the scope and yields `undefined`, which upstream allows (`kind` on
 * `TextEditorSelectionChangeEvent` is optional).
 */
export type CursorChangeSource = "keyboard" | "mouse" | "command";

let currentSource: CursorChangeSource | undefined;

/** Read only synchronously, inside the selection change handler. */
export function currentCursorChangeSource(): CursorChangeSource | undefined {
    return currentSource;
}

/**
 * Nesting keeps the outer source: a keybinding that runs a command stays
 * `keyboard`, as in VS Code.
 */
export function withCursorChangeSource<T>(source: CursorChangeSource, fn: () => T): T {
    const previous = currentSource;
    currentSource = previous ?? source;
    try {
        return fn();
    } finally {
        currentSource = previous;
    }
}
