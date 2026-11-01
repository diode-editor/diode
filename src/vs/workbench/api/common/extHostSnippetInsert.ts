import type * as vscode from "vscode";

import { Range } from "./vscodeTypes.ts";
import type { IWireEditorEdit, IWireSelection } from "./wireTypes.ts";

/**
 * `TextEditor.insertSnippet` without a snippet session (class C of the API matrix): the text goes in as upstream's
 * `SnippetParser` makes it and with upstream's indentation, the caret lands on the first tab stop, but Tab does not
 * walk the remaining stops. Variables stay literal text.
 */

type SnippetNode =
    | { readonly text: string }
    /** `children: null` has no text of its own: `$1`, `${1}`. A mirror takes the text of its placeholder. */
    | { readonly tabStop: number; readonly children: readonly SnippetNode[] | null };

export interface IResolvedSnippet {
    readonly text: string;
    /** Offsets in `text` of what the caret selects: a placeholder's text, or an empty range. */
    readonly selectionStart: number;
    readonly selectionEnd: number;
}

export interface ISnippetIndentation {
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

export interface ISnippetEdits {
    readonly edits: readonly IWireEditorEdit[];
    readonly selectionsAfter: readonly IWireSelection[];
}

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
    const flush = (): void => {
        nodes.push({ text });
        text = "";
    };
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
        flush();
        nodes.push(stop.node);
        index = stop.end;
    }
    flush();
    return { nodes, end: index };
}

/** `first` keeps the first placeholder with text per stop: upstream's `fillInIncompletePlaceholder`. */
function collectStops(
    nodes: readonly SnippetNode[],
    first: Map<number, readonly SnippetNode[]>,
    stops: number[],
): void {
    for (const node of nodes) {
        if ("text" in node) continue;
        stops.push(node.tabStop);
        if (node.children === null) continue;
        if (!first.has(node.tabStop)) first.set(node.tabStop, node.children);
        collectStops(node.children, first, stops);
    }
}

/** Not `autoIndent.getLeadingWhitespace`: that module would join the code shared by the extension host role and the core. */
function getLeadingWhitespace(line: string): string {
    return line.slice(0, line.search(/[^ \t]|$/));
}

/** Upstream's `model.normalizeIndentation`: the leading whitespace is rewritten for the editor's tab settings. */
function normalizeIndentation(line: string, { tabSize, insertSpaces }: ISnippetIndentation): string {
    const leading = getLeadingWhitespace(line);
    let columns = 0;
    for (const char of leading) columns += char === "\t" ? tabSize - (columns % tabSize) : 1;
    const indent = insertSpaces
        ? " ".repeat(columns)
        : "\t".repeat(Math.floor(columns / tabSize)) + " ".repeat(columns % tabSize);
    return indent + line.slice(leading.length);
}

/**
 * Upstream `SnippetSession.adjustWhitespace`, segment by segment, so that the caret stays on its boundary. The
 * snippet start is only normalized; every further line, and a segment following a line break, gets the leading
 * whitespace of the line the snippet goes into. `indentation: null` is `keepWhitespace`.
 */
export function resolveSnippet(
    template: string,
    lineLeadingWhitespace: string,
    indentation: ISnippetIndentation | null,
): IResolvedSnippet {
    const { nodes } = parseNodes(template, 0, false);
    const placeholders = new Map<number, readonly SnippetNode[]>();
    // Stryker disable next-line ArrayDeclaration: equivalent, the filter below drops a non-number
    const stops: number[] = [];
    collectStops(nodes, placeholders, stops);
    const positive = stops.filter((stop) => stop > 0);
    // The caret goes to the first stop; `$0` is the last one, and without any stops the end of the text is.
    const target = positive.length > 0 ? Math.min(...positive) : 0;

    let text = "";
    let selection: { start: number; end: number } | null = null;
    /** A mirror inside its own placeholder would never end. */
    const open = new Set<number>();
    const appendText = (value: string): void => {
        const lines = value.split(/\r\n|\r|\n/);
        const adjusted =
            indentation === null
                ? lines
                : lines.map((line, index) => {
                      if (index > 0) return normalizeIndentation(lineLeadingWhitespace + line, indentation);
                      if (text.length === 0) return normalizeIndentation(line, indentation);
                      return text.endsWith("\n")
                          ? normalizeIndentation(lineLeadingWhitespace + line, indentation)
                          : line;
                  });
        text += adjusted.join("\n");
    };
    const append = (list: readonly SnippetNode[]): void => {
        for (const node of list) {
            if ("text" in node) {
                appendText(node.text);
                continue;
            }
            if (open.has(node.tabStop)) continue;
            const start = text.length;
            open.add(node.tabStop);
            append(node.children ?? placeholders.get(node.tabStop) ?? []);
            open.delete(node.tabStop);
            if (selection === null && node.tabStop === target) selection = { start, end: text.length };
        }
    };
    append(nodes);
    const found = selection as { start: number; end: number } | null;
    return {
        text,
        selectionStart: found?.start ?? text.length,
        selectionEnd: found?.end ?? text.length,
    };
}

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

function positionAfter(line: number, character: number, inserted: string): { line: number; character: number } {
    const lines = inserted.split("\n");
    const last = lines[lines.length - 1];
    return lines.length === 1
        ? { line, character: character + last.length }
        : { line: line + lines.length - 1, character: last.length };
}

/**
 * One edit per range. The caret of each is computed in the document as it will be after the whole batch, and travels
 * with the edit: a key typed right after Enter must not reach a caret that has not moved yet.
 */
export function buildSnippetEdits(
    document: vscode.TextDocument,
    template: string,
    ranges: readonly vscode.Range[],
    indentation: ISnippetIndentation,
    keepWhitespace: boolean,
): ISnippetEdits {
    const sorted = ranges
        .map((range) => document.validateRange(range))
        .sort((a, b) => a.start.compareTo(b.start) || a.end.compareTo(b.end));
    const edits: IWireEditorEdit[] = [];
    const selectionsAfter: IWireSelection[] = [];
    let lineDelta = 0;
    // Stryker disable next-line UnaryOperator: equivalent, `characterDelta` is 0 until `shiftedLine` is assigned
    let shiftedLine = -1;
    let characterDelta = 0;
    for (const range of sorted) {
        const { start, end } = range;
        const lead = getLeadingWhitespace(document.lineAt(start.line).text.slice(0, start.character));
        const resolved = resolveSnippet(template, lead, keepWhitespace ? null : indentation);
        edits.push({
            range: {
                start: { line: start.line, character: start.character },
                end: { line: end.line, character: end.character },
            },
            text: resolved.text,
        });
        const newLine = start.line + lineDelta;
        const newCharacter = start.character + (start.line === shiftedLine ? characterDelta : 0);
        const anchor = positionAfter(newLine, newCharacter, resolved.text.slice(0, resolved.selectionStart));
        const active = positionAfter(newLine, newCharacter, resolved.text.slice(0, resolved.selectionEnd));
        selectionsAfter.push({
            anchorLine: anchor.line,
            anchorCharacter: anchor.character,
            activeLine: active.line,
            activeCharacter: active.character,
        });
        const editEnd = positionAfter(newLine, newCharacter, resolved.text);
        lineDelta = editEnd.line - end.line;
        shiftedLine = end.line;
        characterDelta = editEnd.character - end.character;
    }
    return { edits, selectionsAfter };
}
