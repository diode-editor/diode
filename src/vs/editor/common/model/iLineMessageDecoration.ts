/**
 * A message after the end of a line (upstream: a content widget at the line's end, or an `after` decoration of a
 * whole line), as the test messages are shown. It is painted over the empty cells right of the line's last fragment,
 * after a gap, and cut by the editor's right edge: it neither wraps nor widens the line, the caret never enters it.
 * Clicking it fires `EditorElement.onDidClickLineMessage` with its `key`; the cursor stays.
 */
export interface ILineMessageDecoration {
    /** The owner's identity: one set again with the same `key` and `line` keeps the line it moved to. */
    readonly key: string;
    /** 0-based. */
    readonly line: number;
    /** One line, without control characters. */
    readonly text: string;
    /** A theme token; a translucent one is blended over the background. */
    readonly colorToken: string;
    /** A theme token of the cells' background; absent — the editor's. */
    readonly bgToken?: string;
}
