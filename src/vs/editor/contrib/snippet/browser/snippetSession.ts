import { groupAdjacentBy } from "../../../../base/common/arrays.ts";
import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import { commonPrefixLength, splitLines } from "../../../../base/common/strings.ts";
import { comparePositions, type IPosition, positionsEqual } from "../../../common/core/iPosition.ts";
import { type IRange, rangeContainsRange } from "../../../common/core/iRange.ts";
import { createSelection, type ISelection, selectionToRange } from "../../../common/core/iSelection.ts";
import { createTextEdit, type ITextEdit } from "../../../common/core/iTextEdit.ts";
import { countEOL } from "../../../common/core/misc/eolCounter.ts";
import { DEFAULT_WORD_REGEXP, getWordAtText } from "../../../common/core/wordHelper.ts";
import { getLeadingWhitespace } from "../../../common/languages/autoIndent.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";
import { TrackedRangeStickiness } from "../../../common/model/trackedDecorations.ts";

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
 * Port of upstream `SnippetSession` for a list of edits (`createEditsAndSnippetsFromEdits`, as
 * `MainThreadTextEditor.insertSnippet` calls it): the text of every edit, then the tab stops of the inserted snippet.
 */

/** What the insert reads of the document; lines are LF-canonical, as `ITextDocument` stores them. */
export type ISnippetDocument = Pick<ITextDocument, "getLineContent" | "getTextInRange">;

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
    /** The inserted text from the first edit's start, which the insert does not move; the gaps between the edits included. */
    readonly snippet: TextmateSnippet;
}

const EOL = "\n";

/** Upstream `normalizeIndentation` (`core/misc/indentation.ts`): the leading whitespace for the tab settings. */
function normalizeIndentation(
    line: string,
    { tabSize, insertSpaces }: Pick<ISnippetInsertOptions, "tabSize" | "insertSpaces">,
): string {
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
    });
    // Upstream `createEditsAndSnippetsFromEdits`: a snippet with placeholders and no `$0` ends in one.
    parser.ensureFinalTabstop(snippet, false, true);
    return { edits, snippet };
}

/** What a session reads and decorates of the document. */
export type ISnippetSessionDocument = Pick<
    ITextDocument,
    "deltaDecorations" | "getDecorationRange" | "changeDecorationOptions" | "getTextInRange"
>;

/** What {@link SnippetSession.placeholderTransformEdits} indents a multi-line result with. */
export interface ISnippetSessionIndentation {
    /** The leading whitespace of the line the snippet starts on. */
    readonly lineLeadingWhitespace: string;
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

const ACTIVE = {
    description: "snippet-placeholder-active",
    stickiness: TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
};
const INACTIVE = { description: "snippet-placeholder", stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges };

/**
 * Port of upstream `OneSnippet` with the parts of `SnippetSession` it needs: an insert from edits is always one
 * snippet over all of them. A placeholder is a tracked decoration; the active group's placeholders (and the ones
 * enclosing them) grow when typing at their edges, the rest never do. Mirrors are no mechanism of their own: `move`
 * gives a selection per placeholder of the group, and the editor's carets type into each.
 */
export class SnippetSession {
    /** Upstream `groupBy(placeholders, Placeholder.compareByIndex)`: by index, `$0` last, document order inside. */
    private readonly groups: Placeholder[][];
    private groupIndex = -1;
    private readonly decorations = new Map<Placeholder, string>();

    /** `snippet` is in the document from `start`, as {@link createSnippetInsert} built it. */
    public constructor(
        private readonly document: ISnippetSessionDocument,
        private readonly snippet: TextmateSnippet,
        start: IPosition,
        private readonly indentation: ISnippetSessionIndentation,
    ) {
        this.groups = [
            ...groupAdjacentBy(
                [...snippet.placeholders].sort((a, b) => Placeholder.compareByIndex(a, b)),
                (a, b) => a.index === b.index,
            ),
        ];
        const text = snippet.toString();
        const at = (snippetOffset: number): IPosition => positionAfter(start, text.slice(0, snippetOffset));
        const { placeholders } = snippet;
        const ids = document.deltaDecorations(
            // Stryker disable next-line ArrayDeclaration: equivalent, an unknown id to remove is ignored
            [],
            placeholders.map((placeholder) => {
                const from = snippet.offset(placeholder);
                return {
                    range: { start: at(from), end: at(from + snippet.fullLen(placeholder)) },
                    options: INACTIVE,
                };
            }),
        );
        placeholders.forEach((placeholder, i) => this.decorations.set(placeholder, ids[i]));
    }

    public dispose(): void {
        this.document.deltaDecorations([...this.decorations.values()], []);
    }

    public get isAtFirstPlaceholder(): boolean {
        return this.groupIndex <= 0;
    }

    public get isAtLastPlaceholder(): boolean {
        return this.groupIndex === this.groups.length - 1;
    }

    /**
     * Upstream `OneSnippet.move`, its first half: the edits that leave the current group, its placeholders with a
     * transform replaced by the transform of their text. Further lines of a result get the indentation of the
     * snippet's line. Only after the first {@link move}.
     */
    public placeholderTransformEdits(): ITextEdit[] {
        const edits: ITextEdit[] = [];
        for (const placeholder of this.groups[this.groupIndex]) {
            const { transform } = placeholder;
            if (transform === undefined) continue;
            const range = this.rangeOf(placeholder);
            const lines = splitLines(transform.resolve(this.document.getTextInRange(range)));
            for (let i = 1; i < lines.length; i++) {
                lines[i] = normalizeIndentation(this.indentation.lineLeadingWhitespace + lines[i], this.indentation);
            }
            edits.push(createTextEdit(range, lines.join(EOL)));
        }
        return edits;
    }

    /**
     * Upstream `OneSnippet.activeChoice`: the choice of the current group's first placeholder, and where that
     * placeholder is now. Only after the first {@link move}.
     */
    public get activeChoice(): { readonly choice: Choice; readonly range: IRange } | undefined {
        const [placeholder] = this.groups[this.groupIndex];
        const { choice } = placeholder;
        return choice === undefined ? undefined : { choice, range: this.rangeOf(placeholder) };
    }

    /**
     * Upstream `OneSnippet.move`, its second half: to the next group or the previous one; a group whose placeholders were all deleted
     * by the user is skipped.
     */
    public move(fwd: boolean): ISelection[] {
        let couldSkipThisPlaceholder = false;
        if (fwd && this.groupIndex < this.groups.length - 1) {
            this.groupIndex += 1;
            couldSkipThisPlaceholder = true;
        } else if (!fwd && this.groupIndex > 0) {
            this.groupIndex -= 1;
            couldSkipThisPlaceholder = true;
        }
        const active = new Set<Placeholder>();
        const selections: ISelection[] = [];
        for (const placeholder of this.groups[this.groupIndex]) {
            couldSkipThisPlaceholder &&= this.hasPlaceholderBeenCollapsed(placeholder);
            const { start, end } = this.rangeOf(placeholder);
            selections.push(createSelection(start.line, start.character, end.line, end.character));
            // Upstream keeps the final tab stop from growing; the session ends on it, so that never shows.
            active.add(placeholder);
            for (const enclosing of this.snippet.enclosingPlaceholders(placeholder)) active.add(enclosing);
        }
        for (const [placeholder, id] of this.decorations) {
            this.document.changeDecorationOptions(id, active.has(placeholder) ? ACTIVE : INACTIVE);
        }
        return couldSkipThisPlaceholder ? this.move(fwd) : selections;
    }

    /**
     * Upstream `_hasPlaceholderBeenCollapsed`: the placeholder, or one enclosing it, had text when authored and its
     * range is empty now.
     */
    private hasPlaceholderBeenCollapsed(placeholder: Placeholder): boolean {
        return [placeholder, ...this.snippet.enclosingPlaceholders(placeholder)].some((marker) => {
            const { start, end } = this.rangeOf(marker);
            return positionsEqual(start, end) && marker.toString().length > 0;
        });
    }

    /**
     * Upstream `SnippetSession.isSelectionWithinPlaceholders` for one snippet: some group other than `$0` has as many
     * placeholders as there are selections, each containing its selection. Both are in document order already: the
     * editor sorts its selections, and a group keeps the order of the snippet, which tracked ranges never change.
     */
    public isSelectionWithinPlaceholders(selections: readonly ISelection[]): boolean {
        return this.groups.some(
            (group) =>
                !group[0].isFinalTabstop &&
                group.length === selections.length &&
                group.every((placeholder, i) =>
                    rangeContainsRange(this.rangeOf(placeholder), selectionToRange(selections[i])),
                ),
        );
    }

    /**
     * Where the tab stops are now, `$0` left out, for the frame: a placeholder inside another one left out, so none
     * overlap. Sorted as the snippet walks them, an enclosing placeholder before the ones it holds.
     */
    public tabstopRanges(): IRange[] {
        const ranges = [...this.decorations.keys()]
            .filter((placeholder) => !placeholder.isFinalTabstop)
            .map((placeholder) => this.rangeOf(placeholder));
        const outer: IRange[] = [];
        for (const range of ranges) {
            const last = outer.at(-1);
            if (last === undefined || !rangeContainsRange(last, range)) outer.push(range);
        }
        return outer;
    }

    private rangeOf(placeholder: Placeholder): IRange {
        // Only this class removes its decorations.
        return assertReturnsDefined(
            this.document.getDecorationRange(assertReturnsDefined(this.decorations.get(placeholder))),
        );
    }
}
