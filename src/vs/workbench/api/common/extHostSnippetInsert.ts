import type * as vscode from "vscode";

import { Range } from "./vscodeTypes.ts";

/** Upstream's `where`: nothing or an empty list means the selections; a position is an empty range. */
export function snippetRanges(
    location: vscode.Position | vscode.Range | readonly vscode.Position[] | readonly vscode.Range[] | undefined,
    selections: readonly vscode.Selection[],
): readonly vscode.Range[] {
    if (location === undefined || (Array.isArray(location) && location.length === 0)) return selections;
    const list: readonly (vscode.Position | vscode.Range)[] = Array.isArray(location) ? location : [location];
    return list.map((item) =>
        item instanceof Range ? item : new Range(item as vscode.Position, item as vscode.Position),
    );
}

/**
 * Completions and `SnippetTextEdit` have no snippet session yet (#1035): they take the text a template inserts, as
 * upstream's `SnippetParser.asInsertText`. That parser lives in the core (`editor/contrib/snippet/browser`), which
 * this code shared with the extension host role cannot import, so this is a reduced reading of the same grammar:
 * tab stops, placeholders, choices and escapes; `TM_SELECTED_TEXT` is empty, other variables stay text.
 */

type SnippetNode =
    | { readonly text: string }
    /** `children: null` has no text of its own: `$1`, `${1}`. A mirror takes the text of its placeholder. */
    | { readonly tabStop: number; readonly children: readonly SnippetNode[] | null };

/** The lookahead keeps a longer name, such as `$TM_SELECTED_TEXTS`, from matching. */
const SELECTED_TEXT_VARIABLE = /\$TM_SELECTED_TEXT(?![_a-zA-Z0-9])|\$\{TM_SELECTED_TEXT\}/y;
const PLAIN_STOP = /\$(\d+)|\$\{(\d+)\}/y;
const PLACEHOLDER_START = /\$\{(\d+):/y;
/** The second group is the first option, the only one used; `\,` does not end it. */
const CHOICE = /\$\{(\d+)\|((?:\\.|[^,|\\])*)(?:,(?:\\.|[^|\\])*)?\|\}/y;

/** Upstream `_parseEscaped`: only these are escapes, any other backslash is text. */
function isEscapable(char: string | undefined): boolean {
    return char === "$" || char === "}" || char === "\\";
}

function matchAt(pattern: RegExp, template: string, index: number): RegExpExecArray | null {
    pattern.lastIndex = index;
    return pattern.exec(template);
}

/** A placeholder without its closing brace is `null`: its `$` is then text, as upstream's parser backs off. */
function parseTabStop(template: string, index: number): { node: SnippetNode; end: number } | null {
    if (matchAt(SELECTED_TEXT_VARIABLE, template, index) !== null) {
        return { node: { text: "" }, end: SELECTED_TEXT_VARIABLE.lastIndex };
    }
    const plain = matchAt(PLAIN_STOP, template, index);
    if (plain !== null) {
        const groups: readonly (string | undefined)[] = plain;
        return { node: { tabStop: Number(groups[1] ?? groups[2]), children: null }, end: PLAIN_STOP.lastIndex };
    }
    const choice = matchAt(CHOICE, template, index);
    if (choice !== null) {
        const text = choice[2].replace(/\\([,|\\])/g, "$1");
        return { node: { tabStop: Number(choice[1]), children: [{ text }] }, end: CHOICE.lastIndex };
    }
    const placeholder = matchAt(PLACEHOLDER_START, template, index);
    if (placeholder === null) return null;
    const inner = parseNodes(template, PLACEHOLDER_START.lastIndex, true);
    if (inner.end >= template.length) return null;
    return { node: { tabStop: Number(placeholder[1]), children: inner.nodes }, end: inner.end + 1 };
}

/** Inside a placeholder it stops on the closing brace, and `end` points at it; `end` past the text means none was found. */
function parseNodes(template: string, from: number, inPlaceholder: boolean): { nodes: SnippetNode[]; end: number } {
    const nodes: SnippetNode[] = [];
    let text = "";
    let index = from;
    while (index < template.length) {
        const char = template[index];
        if (char === "}" && inPlaceholder) break;
        if (char === "\\" && isEscapable(template[index + 1])) {
            text += template[index + 1];
            index += 2;
            continue;
        }
        const stop = parseTabStop(template, index);
        if (stop === null) {
            text += char;
            index++;
            continue;
        }
        nodes.push({ text }, stop.node);
        text = "";
        index = stop.end;
    }
    nodes.push({ text });
    return { nodes, end: index };
}

/** `first` keeps the first placeholder with text per stop: upstream's `fillInIncompletePlaceholder`. */
function collectPlaceholders(nodes: readonly SnippetNode[], first: Map<number, readonly SnippetNode[]>): void {
    for (const node of nodes) {
        if ("text" in node || node.children === null) continue;
        if (!first.has(node.tabStop)) first.set(node.tabStop, node.children);
        collectPlaceholders(node.children, first);
    }
}

/** The text a template inserts, without a session and with its whitespace as is. */
export function snippetText(template: string): string {
    const { nodes } = parseNodes(template, 0, false);
    const placeholders = new Map<number, readonly SnippetNode[]>();
    collectPlaceholders(nodes, placeholders);
    /** A mirror inside its own placeholder would never end. */
    const open = new Set<number>();
    const render = (list: readonly SnippetNode[]): string =>
        list
            .map((node) => {
                if ("text" in node) return node.text;
                if (open.has(node.tabStop)) return "";
                open.add(node.tabStop);
                const text = render(node.children ?? placeholders.get(node.tabStop) ?? []);
                open.delete(node.tabStop);
                return text;
            })
            .join("");
    return render(nodes);
}
