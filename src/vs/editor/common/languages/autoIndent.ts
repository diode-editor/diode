import type { IOnEnterAction } from "../../../platform/extensions/common/iLanguageConfiguration.ts";

import type { IResolvedOnEnterRule } from "./languageConfiguration.ts";

/** `indentationRules` are not honored yet; `onEnterRules` are, see {@link findOnEnterAction}. */

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
    /** The matching rule of the language: it wins over the bracket logic, as upstream `OnEnterSupport.onEnter`. */
    readonly enterAction?: IOnEnterAction;
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

/** Upstream `OnEnterSupport.onEnter`, step 1: the first rule whose every given regex matches. */
export function findOnEnterAction(
    rules: readonly IResolvedOnEnterRule[],
    previousLineText: string,
    beforeText: string,
    afterText: string,
): IOnEnterAction | undefined {
    const matches = (regex: RegExp | undefined, text: string): boolean => {
        if (regex === undefined) return true;
        // The "g" flag must not carry state between calls.
        regex.lastIndex = 0;
        return regex.test(text);
    };
    return rules.find(
        (rule) =>
            matches(rule.beforeText, beforeText) &&
            matches(rule.afterText, afterText) &&
            matches(rule.previousLineText, previousLineText),
    )?.action;
}

/** Upstream `unshiftIndent`: back to the previous tab stop. */
function outdent(indentation: string, tabSize: number): string {
    if (indentation.endsWith("\t")) return indentation.slice(0, -1);
    const spaces = indentation.length - indentation.replace(/ +$/, "").length;
    return indentation.slice(0, indentation.length - Math.min(spaces, spaces % tabSize || tabSize));
}

/** Upstream `getEnterAction` + `EnterOperation._enter`. */
function planEnterAction(action: IOnEnterAction, base: string, unit: string, tabSize: number): NewLinePlan {
    const indentation = base.slice(0, Math.max(0, base.length - (action.removeText ?? 0)));
    const appendText = (action.appendText ?? "").replace(/^\t+/, (tabs) => unit.repeat(tabs.length));
    if (action.indent === "indentOutdent") {
        const inner = indentation + (action.appendText === undefined ? unit : appendText);
        return { editText: "\n" + inner + "\n" + indentation, blockExpand: true, cursorColumn: inner.length };
    }
    const start = action.indent === "outdent" ? outdent(indentation, tabSize) : indentation;
    const text = start + (action.indent === "indent" ? unit : "") + appendText;
    return { editText: "\n" + text, blockExpand: false, cursorColumn: text.length };
}

export function computeNewLinePlan(params: NewLinePlanParams): NewLinePlan {
    const { lineContent, column, tabSize, insertSpaces, enterAction } = params;

    const leading = getLeadingWhitespace(lineContent);
    // Cursor inside the indent: never carry more than the cursor sits at.
    const base = leading.slice(0, Math.min(leading.length, column));
    const unit = insertSpaces ? " ".repeat(tabSize) : "\t";

    if (enterAction !== undefined) return planEnterAction(enterAction, base, unit, tabSize);

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
