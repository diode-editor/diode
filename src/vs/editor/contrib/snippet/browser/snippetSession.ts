import { commonPrefixLength, splitLines } from "../../../../base/common/strings.ts";
import { comparePositions, type IPosition } from "../../../common/core/iPosition.ts";
import type { IRange } from "../../../common/core/iRange.ts";
import { createSelection, type ISelection } from "../../../common/core/iSelection.ts";
import { createTextEdit, hasOverlappingEdits, type ITextEdit } from "../../../common/core/iTextEdit.ts";
import { countEOL } from "../../../common/core/misc/eolCounter.ts";
import { DEFAULT_WORD_REGEXP, getWordAtText } from "../../../common/core/wordHelper.ts";
import { getLeadingWhitespace } from "../../../common/languages/autoIndent.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";
import type { EditorViewState } from "../../../common/viewModel/editorViewState.ts";
import type { ICursorStateComputer } from "../../../common/viewModel/trackedSelections.ts";

import {
    Choice,
    type Marker,
    Placeholder,
    SnippetParser,
    Text,
    TextmateSnippet,
    Variable,
    type VariableResolver,
} from "./snippetParser.ts";

/**
 * Port of upstream `SnippetSession.insert` for a list of edits (`createEditsAndSnippetsFromEdits`, as
 * `MainThreadTextEditor.insertSnippet` calls it): the text of every edit and the first caret. There is no session
 * yet: Tab, mirrors that follow typing and `$0` as a stop come with the session itself (#1032).
 */

/** What the insert reads of the document; lines are LF-canonical, as `ITextDocument` stores them. */
export type ISnippetDocument = Pick<ITextDocument, "getLineContent" | "getTextInRange">;

/** What the insert needs of a text editor pane. */
export interface ISnippetEditor {
    readonly model: { readonly document: ISnippetDocument };
    readonly viewState: Pick<EditorViewState, "tabSize" | "insertSpaces" | "selections" | "revealRangeByType">;
    focusEditor(): void;
    applyExternalEdits(
        edits: readonly ITextEdit[],
        label: string,
        computeCursorState: ICursorStateComputer,
        undoStops: { readonly undoStopBefore?: boolean; readonly undoStopAfter?: boolean },
    ): void;
}

export interface ISnippetApplyOptions {
    readonly keepWhitespace?: boolean;
    readonly undoStopBefore?: boolean;
    readonly undoStopAfter?: boolean;
}

export interface ISnippetEdit {
    readonly range: IRange;
    readonly template: string;
}

export interface ISnippetInsertOptions {
    /** `false` is `keepWhitespace`. */
    readonly adjustWhitespace: boolean;
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

export interface ISnippetInsert {
    /** In document order, against the text before the insert. */
    readonly edits: readonly ITextEdit[];
    /** Against the text after the insert. */
    readonly selections: readonly ISelection[];
}

const EOL = "\n";

/** Upstream `normalizeIndentation` (`core/misc/indentation.ts`): the leading whitespace for the tab settings. */
function normalizeIndentation(line: string, { tabSize, insertSpaces }: ISnippetInsertOptions): string {
    const leading = getLeadingWhitespace(line);
    let columns = 0;
    for (const char of leading) columns += char === "\t" ? tabSize - (columns % tabSize) : 1;
    const indent = insertSpaces
        ? " ".repeat(columns)
        : "\t".repeat(Math.floor(columns / tabSize)) + " ".repeat(columns % tabSize);
    return indent + line.slice(leading.length);
}

/**
 * Upstream `SnippetSession.adjustWhitespace` over the markers of one edit: the snippet start is only normalized,
 * every further line and a text that follows a line break get the leading whitespace of the line at `position`.
 */
function adjustWhitespace(
    document: ISnippetDocument,
    position: IPosition,
    snippet: TextmateSnippet,
    fragment: ReadonlySet<Marker>,
    options: ISnippetInsertOptions,
): void {
    const lineLeadingWhitespace = getLeadingWhitespace(
        document.getLineContent(position.line).slice(0, position.character),
    );
    let snippetText: string | undefined;
    snippet.walk((marker) => {
        if (!(marker instanceof Text) || marker.parent instanceof Choice || !fragment.has(marker)) return true;
        const lines = splitLines(marker.value);
        if (options.adjustWhitespace) {
            const offset = snippet.offset(marker);
            if (offset === 0) {
                lines[0] = normalizeIndentation(lines[0], options);
            } else {
                snippetText ??= snippet.toString();
                const previous = snippetText[offset - 1];
                if (previous === "\n" || previous === "\r") {
                    lines[0] = normalizeIndentation(lineLeadingWhitespace + lines[0], options);
                }
            }
            for (let i = 1; i < lines.length; i++) {
                lines[i] = normalizeIndentation(lineLeadingWhitespace + lines[i], options);
            }
        }
        marker.parent.replace(marker, [new Text(lines.join(EOL))]);
        snippetText = undefined;
        return true;
    });
}

/**
 * Upstream `SelectionBasedVariableResolver` for an edit's range (a left-to-right selection: its position is the
 * range end), without the overtyping capturer. The other resolvers come with #1034: a variable they would resolve
 * keeps its default, or is empty.
 */
class SelectionBasedVariableResolver implements VariableResolver {
    public constructor(
        private readonly document: ISnippetDocument,
        private readonly snippet: TextmateSnippet,
        private readonly range: IRange,
        private readonly index: number,
    ) {}

    public resolve(variable: Variable): string | undefined {
        const { line, character } = this.range.end;
        switch (variable.name) {
            case "SELECTION":
            case "TM_SELECTED_TEXT":
                return this.selectedText(variable);
            case "TM_CURRENT_LINE":
                return this.document.getLineContent(line);
            case "TM_CURRENT_WORD": {
                const text = this.document.getLineContent(line);
                const word = getWordAtText(character, DEFAULT_WORD_REGEXP, text);
                return word === null ? undefined : text.slice(word.start, word.end);
            }
            case "TM_LINE_INDEX":
                return String(line);
            case "TM_LINE_NUMBER":
                return String(line + 1);
            case "CURSOR_INDEX":
                return String(this.index);
            case "CURSOR_NUMBER":
                return String(this.index + 1);
        }
        return undefined;
    }

    /**
     * A multi-line selection gets the indentation the variable has in the snippet on top of the indentation of the
     * selection's first line.
     */
    private selectedText(variable: Variable): string | undefined {
        const value = this.document.getTextInRange(this.range);
        if (value === "") return undefined;
        const lineLeadingWhitespace = getLeadingWhitespace(
            this.document.getLineContent(this.range.start.line).slice(0, this.range.start.character),
        );
        let variableLeadingWhitespace = lineLeadingWhitespace;
        this.snippet.walk((marker) => {
            if (marker === variable) return false;
            if (marker instanceof Text) {
                const lines = splitLines(marker.value);
                variableLeadingWhitespace = getLeadingWhitespace(lines[lines.length - 1]);
            }
            return true;
        });
        const extra = variableLeadingWhitespace.slice(
            commonPrefixLength(variableLeadingWhitespace, lineLeadingWhitespace),
        );
        return value.replace(/\r\n|\r|\n/g, (newline) => newline + extra);
    }
}

function positionAfter(start: IPosition, text: string): IPosition {
    const [lineBreaks, , lastLineLength] = countEOL(text);
    return lineBreaks === 0
        ? { line: start.line, character: start.character + lastLineLength }
        : { line: start.line + lineBreaks, character: lastLineLength };
}

/**
 * `snippetEdits` is not empty. One snippet over all edits, as upstream: the text between the edits goes in as text
 * markers, so a placeholder's offset in the snippet is its offset from the first edit's start in the new text, and a
 * tab stop that repeats in every edit is one group, selected in each.
 */
export function createSnippetInsert(
    document: ISnippetDocument,
    snippetEdits: readonly ISnippetEdit[],
    options: ISnippetInsertOptions,
): ISnippetInsert {
    const indexed = snippetEdits
        .map((edit, index) => ({ edit, index }))
        .sort((a, b) => comparePositions(a.edit.range.start, b.edit.range.start));
    const parser = new SnippetParser();
    const snippet = new TextmateSnippet();
    const edits: ITextEdit[] = [];
    /** Where each edit ends in the snippet text. */
    const ends: number[] = [];
    let offset = 0;
    indexed.forEach(({ edit: { range, template }, index }, i) => {
        if (i > 0) {
            const gap = new Text(document.getTextInRange({ start: indexed[i - 1].edit.range.end, end: range.start }));
            snippet.appendChild(gap);
            offset += gap.value.length;
        }
        // Upstream #206121: only this edit's variables, and the ones backfilled into earlier placeholders.
        const before = new Set<Marker>();
        snippet.walk((marker) => {
            before.add(marker);
            return true;
        });
        const fragment = parser.parseFragment(template, snippet);
        adjustWhitespace(document, range.start, snippet, new Set(fragment), options);
        const resolver = new SelectionBasedVariableResolver(document, snippet, range, index);
        snippet.walk((marker) => {
            if (marker instanceof Variable && !before.has(marker)) marker.resolve(resolver);
            return true;
        });
        const text = snippet.toString();
        edits.push(createTextEdit(range, text.slice(offset)));
        offset = text.length;
        ends.push(offset);
    });

    const start = indexed[0].edit.range.start;
    const text = snippet.toString();
    const at = (snippetOffset: number): IPosition => positionAfter(start, text.slice(0, snippetOffset));
    const { placeholders } = snippet;
    // Upstream `OneSnippet.move(true)` from the start: every placeholder of the first group, `$0` sorting last;
    // without placeholders, a caret at the end of every edit. Upstream's `ensureFinalTabstop` adds a `$0` that only
    // the session (#1032) reaches.
    let spans: (readonly [number, number])[];
    if (placeholders.length === 0) {
        spans = ends.map((end) => [end, end] as const);
    } else {
        const positive = placeholders.map((placeholder) => placeholder.index).filter((index) => index > 0);
        const first = positive.length > 0 ? Math.min(...positive) : 0;
        spans = placeholders
            .filter((placeholder) => placeholder.index === first)
            .map((placeholder) => {
                const from = snippet.offset(placeholder);
                return [from, from + snippet.fullLen(placeholder)] as const;
            });
    }
    const selections = spans.map(([from, to]) => {
        const anchor = at(from);
        const active = at(to);
        return createSelection(anchor.line, anchor.character, active.line, active.character);
    });
    return { edits, selections };
}

/**
 * Upstream `SnippetController2.apply` → `SnippetSession.insert`: the edits and the first caret as one step, the caret
 * revealed. `false`, with nothing changed, for overlapping ranges.
 */
export function insertSnippet(
    editor: ISnippetEditor,
    snippetEdits: readonly ISnippetEdit[],
    options: ISnippetApplyOptions,
): boolean {
    const { viewState } = editor;
    const { edits, selections } = createSnippetInsert(editor.model.document, snippetEdits, {
        adjustWhitespace: options.keepWhitespace !== true,
        tabSize: viewState.tabSize,
        insertSpaces: viewState.insertSpaces,
    });
    if (hasOverlappingEdits(edits)) return false;
    editor.focusEditor();
    editor.applyExternalEdits(edits, "snippet", () => [...selections], options);
    const [primary] = viewState.selections;
    viewState.revealRangeByType({ start: primary.active, end: primary.active }, "default");
    return true;
}
