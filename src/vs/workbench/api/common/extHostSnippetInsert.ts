import type * as vscode from "vscode";

import { Range } from "./vscodeTypes.ts";
import type { IWireEditorEdit, IWireSelection } from "./wireTypes.ts";

/**
 * `TextEditor.insertSnippet` without a snippet session (class C of the API matrix): the text goes in with
 * upstream's indentation and the caret lands on the first tab stop, but Tab does not walk the remaining stops.
 * The grammar is the one of `stripSnippetPlaceholders`; variables stay literal text.
 */

interface ISnippetSegment {
    readonly text: string;
    /** Set when the segment is a tab stop: `$1`, `${1}`, `${1:text}`, `${1|a,b|}`. */
    readonly tabStop?: number;
}

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

/** An escaped dollar, `$1`, or `${1}` with an optional `:text` or `|a,b|`. */
const SNIPPET_TOKEN = /\\\$|\$(?:(\d+)|\{(\d+)(?::([^}]*)|\|([^|]*)\|)?\})/g;

function parseSnippetSegments(template: string): ISnippetSegment[] {
    const segments: ISnippetSegment[] = [];
    let text = "";
    let last = 0;
    for (const match of template.matchAll(SNIPPET_TOKEN)) {
        text += template.slice(last, match.index);
        last = match.index + match[0].length;
        // Groups that did not take part are `undefined`, which the type of a match does not say.
        const groups: readonly (string | undefined)[] = match;
        const [, plainStop, bracedStop, placeholder, choices] = groups;
        const tabStop = plainStop ?? bracedStop;
        if (tabStop === undefined) {
            text += "$";
            continue;
        }
        segments.push({ text });
        text = "";
        // Stryker disable next-line StringLiteral: equivalent `join` separator, `split(…, 1)` yields one element
        segments.push({ text: placeholder ?? choices?.split(",", 1).join("") ?? "", tabStop: Number(tabStop) });
    }
    segments.push({ text: text + template.slice(last) });
    return segments;
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
    const segments = parseSnippetSegments(template);
    // Stryker disable next-line ConditionalExpression: equivalent, `undefined > 0` is false as well
    const positive = segments.flatMap(({ tabStop }) => (tabStop !== undefined && tabStop > 0 ? [tabStop] : []));
    // The caret goes to the first stop; `$0` is the last one, and without any stops the end of the text is.
    const target = positive.length > 0 ? Math.min(...positive) : 0;

    let text = "";
    let selection: { start: number; end: number } | null = null;
    for (const segment of segments) {
        const lines = segment.text.split(/\r\n|\r|\n/);
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
        const start = text.length;
        text += adjusted.join("\n");
        if (selection === null && segment.tabStop === target) selection = { start, end: text.length };
    }
    return {
        text,
        selectionStart: selection?.start ?? text.length,
        selectionEnd: selection?.end ?? text.length,
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
