/** `language-configuration.json` / `indentationRules` are not honored yet. */

const OPEN_TO_CLOSE = new Map<string, string>([
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
]);

export interface NewLinePlanParams {
    readonly lineContent: string;
    readonly column: number;
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

export interface NewLinePlan {
    /** Always starts with `"\n"`. */
    readonly editText: string;
    /** The cursor goes to the middle of the two new lines, not to the end of the text. */
    readonly blockExpand: boolean;
    readonly cursorColumn: number;
}

export function getLeadingWhitespace(line: string): string {
    let i = 0;
    while (i < line.length && (line[i] === " " || line[i] === "\t")) {
        i++;
    }
    return line.slice(0, i);
}

export function computeNewLinePlan(params: NewLinePlanParams): NewLinePlan {
    const { lineContent, column, tabSize, insertSpaces } = params;

    const leading = getLeadingWhitespace(lineContent);
    // Cursor inside the indent: never carry more than the cursor sits at.
    const base = leading.slice(0, Math.min(leading.length, column));
    const unit = insertSpaces ? " ".repeat(tabSize) : "\t";

    const before = lineContent.slice(0, column).replace(/\s+$/, "");
    const after = lineContent.slice(column);

    const openChar = before.length > 0 ? before[before.length - 1] : "";
    const closeChar = OPEN_TO_CLOSE.get(openChar);

    if (closeChar !== undefined) {
        const inner = base + unit;
        if (after.startsWith(closeChar)) {
            // `{|}` → expand the block; closer drops to its own line at the base indent.
            return { editText: "\n" + inner + "\n" + base, blockExpand: true, cursorColumn: inner.length };
        }
        return { editText: "\n" + inner, blockExpand: false, cursorColumn: inner.length };
    }

    return { editText: "\n" + base, blockExpand: false, cursorColumn: base.length };
}
