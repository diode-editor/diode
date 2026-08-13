import { expect } from "vitest";

import { reject } from "@tuidom/all/common/typingUtils";
import { comparePositions } from "../../common/core/iPosition.ts";
import type { ISelection } from "../../common/core/iSelection.ts";
import {
    createCursorSelection,
    createSelection,
    isSelectionCollapsed,
    selectionToRange,
} from "../../common/core/iSelection.ts";
import { PlainTextTokenizer } from "../../common/languages/builtin/plainTextTokenizer.ts";
import type { ILineTokens } from "../../common/languages/iLineTokens.ts";
import { createLineTokens, createToken } from "../../common/languages/iLineTokens.ts";
import { TextDocument } from "../../common/model/textDocument.ts";
import { DocumentTokenStore } from "../../common/tokens/documentTokenStore.ts";
import { EditorViewState } from "../../common/viewModel/editorViewState.ts";
import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";

// ─── Constants ──────────────────────────────────────────────

const CURSOR_CHAR = "█";
const SELECT_CHAR = "░";

const TRACK_PREFIX_TEXT = "text:";
const TRACK_PREFIX_CURSOR = "cursor:";
const TRACK_PREFIX_SELECT = "select:";
const TRACK_PREFIX_TOKENS = "tokens:";
const TRACK_PREFIX_FOLDING = "folding:";

// Folding track symbols
const FOLD_EXPANDED_START = "v";
const FOLD_COLLAPSED_START = ">";
const FOLD_BODY = "|";
const FOLD_END = "^";

// ─── Tagged Template ────────────────────────────────────────

/**
 * Tagged template literal for editor state DSL strings.
 * Dedents the string and trims leading/trailing blank lines.
 */
export function editorState(strings: TemplateStringsArray, ...values: unknown[]): string {
    const raw = String.raw(strings, ...values);
    return dedentAndTrim(raw);
}

// ─── parseDSL ───────────────────────────────────────────────

/**
 * Parses a multi-track DSL string into an EditorViewState.
 *
 * Tracks:
 *   text:    — document text lines
 *   cursor:  — cursor positions (█ character)
 *   select:  — selection ranges (░ character)
 *   tokens:  — token type masks (single chars, e.g. 'k' for keyword)
 *   folding: — folding regions (v=expanded start, >=collapsed start, |=body, ^=end)
 */
export function parseDSL(dsl: string): EditorViewState {
    const cleaned = dedentAndTrim(dsl);
    const rawLines = cleaned.split("\n");

    const textLines: string[] = [];
    const cursorTrackByLine = new Map<number, string>();
    const selectTrackByLine = new Map<number, string>();
    const tokensTrackByLine = new Map<number, string>();
    const foldingTrackByLine = new Map<number, string>();

    let currentDocLine = -1;

    for (const rawLine of rawLines) {
        if (rawLine.startsWith(TRACK_PREFIX_TEXT)) {
            currentDocLine++;
            const content = rawLine.substring(TRACK_PREFIX_TEXT.length);
            // Strip exactly one leading space if present (track separator)
            textLines.push(content.startsWith(" ") ? content.substring(1) : content);
        } else if (rawLine.startsWith(TRACK_PREFIX_CURSOR)) {
            const content = rawLine.substring(TRACK_PREFIX_CURSOR.length);
            cursorTrackByLine.set(currentDocLine, content.startsWith(" ") ? content.substring(1) : content);
        } else if (rawLine.startsWith(TRACK_PREFIX_SELECT)) {
            const content = rawLine.substring(TRACK_PREFIX_SELECT.length);
            selectTrackByLine.set(currentDocLine, content.startsWith(" ") ? content.substring(1) : content);
        } else if (rawLine.startsWith(TRACK_PREFIX_TOKENS)) {
            const content = rawLine.substring(TRACK_PREFIX_TOKENS.length);
            tokensTrackByLine.set(currentDocLine, content.startsWith(" ") ? content.substring(1) : content);
        } else if (rawLine.startsWith(TRACK_PREFIX_FOLDING)) {
            const content = rawLine.substring(TRACK_PREFIX_FOLDING.length);
            foldingTrackByLine.set(currentDocLine, content.startsWith(" ") ? content.substring(1) : content);
        }
    }

    // Build document
    const documentText = textLines.join("\n");
    const doc = new TextDocument(documentText);

    // Parse cursors and selections
    const selections: ISelection[] = [];

    // Collect cursor-only positions (█ on cursor track without select track)
    for (const [lineIdx, track] of cursorTrackByLine) {
        const selectTrack = selectTrackByLine.get(lineIdx);
        for (let i = 0; i < track.length; i++) {
            if (track[i] === CURSOR_CHAR) {
                if (selectTrack) {
                    // Cursor is within a selection — will be handled in selection parsing
                    continue;
                }
                selections.push(createCursorSelection(lineIdx, i));
            }
        }
    }

    // Parse selections: find contiguous ░ ranges, use █ as anchor/active indicator
    // For multi-line selections, we need to collect ░ ranges across consecutive lines
    parseSelections(cursorTrackByLine, selectTrackByLine, textLines, selections);

    // Parse tokens — attach them via a token store. We use PlainTextTokenizer
    // as a placeholder support; tokens are pushed externally via setLineTokens.
    let tokenStore: DocumentTokenStore | undefined;
    for (const [lineIdx, track] of tokensTrackByLine) {
        const tokens = parseTokenTrack(track);
        if (tokens.tokens.length > 0) {
            tokenStore ??= new DocumentTokenStore(doc, new PlainTextTokenizer());
            tokenStore.setLineTokens(lineIdx, tokens);
        }
    }

    // Sort selections by position
    selections.sort((a, b) => comparePositions(a.active, b.active));

    // Parse folding regions
    const foldingRegions = parseFoldingTracks(foldingTrackByLine);

    const state = new EditorViewState(doc, selections.length > 0 ? selections : undefined);
    if (foldingRegions.length > 0) {
        state.setFoldingRegions(foldingRegions);
    }
    if (tokenStore) {
        state.tokenStore = tokenStore;
    }
    return state;
}

// ─── renderToDSL ────────────────────────────────────────────

/**
 * Renders an EditorViewState to a multi-track DSL string.
 */
export function renderToDSL(state: EditorViewState): string {
    const doc = state.document;
    const lines: string[] = [];

    for (let lineIdx = 0; lineIdx < doc.lineCount; lineIdx++) {
        const textContent = doc.getLineContent(lineIdx);
        lines.push(`${TRACK_PREFIX_TEXT} ${textContent}`);

        // Render cursor track
        const cursorTrack = renderCursorTrack(state.selections, lineIdx, textContent.length);
        if (cursorTrack !== null) {
            lines.push(`${TRACK_PREFIX_CURSOR} ${cursorTrack}`);
        }

        // Render select track
        const selectTrack = renderSelectTrack(state.selections, lineIdx, textContent.length);
        if (selectTrack !== null) {
            lines.push(`${TRACK_PREFIX_SELECT} ${selectTrack}`);
        }

        // Render tokens track
        const tokens = state.tokenStore?.getLineTokens(lineIdx);
        if (tokens && tokens.tokens.length > 0) {
            const tokensTrack = renderTokensTrack(tokens, textContent.length);
            lines.push(`${TRACK_PREFIX_TOKENS} ${tokensTrack}`);
        }

        // Render folding track
        const foldingChar = renderFoldingChar(state.foldedRegions, lineIdx);
        if (foldingChar !== null) {
            lines.push(`${TRACK_PREFIX_FOLDING} ${foldingChar}`);
        }
    }

    return lines.join("\n");
}

// ─── expectEditorState ──────────────────────────────────────

/**
 * Asserts that an EditorViewState matches the expected DSL string.
 */
export function expectEditorState(state: EditorViewState, expected: string): void {
    const actual = renderToDSL(state);
    const normalizedExpected = dedentAndTrim(expected);
    expect(actual).toBe(normalizedExpected);
}

// ─── Private: Parsing Helpers ───────────────────────────────

function parseSelections(
    cursorTrackByLine: Map<number, string>,
    selectTrackByLine: Map<number, string>,
    textLines: string[],
    selections: ISelection[],
): void {
    // For each line that has a select track, find ░ ranges and locate the cursor █ within
    // For simplicity in MVP: each contiguous run of ░ on a single line is one selection.
    // The █ on the cursor track indicates the active end.

    for (const [lineIdx, selectTrack] of selectTrackByLine) {
        const cursorTrack = cursorTrackByLine.get(lineIdx);
        let i = 0;
        while (i < selectTrack.length) {
            if (selectTrack[i] === SELECT_CHAR) {
                // Find start and end of this ░ run
                const selectStart = i;
                while (i < selectTrack.length && selectTrack[i] === SELECT_CHAR) {
                    i++;
                }
                const selectEnd = i;

                // Find cursor position on this line (within or at edges of selection)
                let cursorPos: number | null = null;
                if (cursorTrack) {
                    for (let c = 0; c < cursorTrack.length; c++) {
                        if (cursorTrack[c] === CURSOR_CHAR) {
                            cursorPos = c;
                            break;
                        }
                    }
                }

                if (cursorPos !== null) {
                    // Cursor defines the active position
                    // If cursor is at selectStart → active = start, anchor = end (backward selection)
                    // If cursor is at selectEnd → active = end, anchor = start (forward selection)
                    if (cursorPos <= selectStart) {
                        selections.push(
                            createSelection(
                                lineIdx,
                                selectEnd, // anchor (end of selection)
                                lineIdx,
                                cursorPos, // active (cursor)
                            ),
                        );
                    } else {
                        selections.push(
                            createSelection(
                                lineIdx,
                                selectStart, // anchor (start of selection)
                                lineIdx,
                                cursorPos, // active (cursor)
                            ),
                        );
                    }
                } else {
                    // No cursor on this line — treat as forward selection
                    selections.push(createSelection(lineIdx, selectStart, lineIdx, selectEnd));
                }
            } else {
                i++;
            }
        }
    }
}

function parseTokenTrack(track: string): ILineTokens {
    if (track.length === 0) {
        return createLineTokens([]);
    }

    const tokens: { startIndex: number; type: string }[] = [];
    let currentType = track[0];

    // Skip spaces — they mean "no token"
    if (currentType !== " ") {
        tokens.push({ startIndex: 0, type: currentType });
    }

    for (let i = 1; i < track.length; i++) {
        const ch = track[i];
        if (ch !== currentType) {
            if (ch !== " ") {
                tokens.push({ startIndex: i, type: ch });
            }
            currentType = ch;
        }
    }

    // Encode `type` as a single-element scope so the legacy single-character
    // DSL keeps working with the new IToken shape.
    return createLineTokens(tokens.map((t) => createToken(t.startIndex, [t.type])));
}

// ─── Private: Rendering Helpers ─────────────────────────────

function renderCursorTrack(selections: readonly ISelection[], lineIdx: number, lineLength: number): string | null {
    const positions: number[] = [];

    for (const sel of selections) {
        if (sel.active.line === lineIdx) {
            positions.push(sel.active.character);
        }
    }

    if (positions.length === 0) {
        return null;
    }

    const maxPos = Math.max(...positions, lineLength - 1);
    const chars = new Array(maxPos + 1).fill(" ");
    for (const pos of positions) {
        chars[pos] = CURSOR_CHAR;
    }

    return trimTrailingSpaces(chars.join(""));
}

function renderSelectTrack(selections: readonly ISelection[], lineIdx: number, lineLength: number): string | null {
    let hasSelection = false;
    const maxLen = Math.max(lineLength, 1);
    const chars = new Array(maxLen).fill(" ");

    for (const sel of selections) {
        if (isSelectionCollapsed(sel)) continue;

        const range = selectionToRange(sel);
        if (range.start.line > lineIdx || range.end.line < lineIdx) continue;

        const startChar = range.start.line === lineIdx ? range.start.character : 0;
        const endChar = range.end.line === lineIdx ? range.end.character : lineLength;

        for (let i = startChar; i < endChar; i++) {
            if (i >= chars.length) {
                chars.push(SELECT_CHAR);
            } else {
                chars[i] = SELECT_CHAR;
            }
            hasSelection = true;
        }
    }

    if (!hasSelection) {
        return null;
    }

    return trimTrailingSpaces(chars.join(""));
}

function renderTokensTrack(tokens: ILineTokens, lineLength: number): string {
    const chars = new Array(lineLength).fill(" ");

    for (let i = 0; i < tokens.tokens.length; i++) {
        const token = tokens.tokens[i];
        const end = i + 1 < tokens.tokens.length ? tokens.tokens[i + 1].startIndex : lineLength;
        const ch = token.scopes[0] ?? " ";

        for (let c = token.startIndex; c < end; c++) {
            if (c < chars.length) {
                chars[c] = ch;
            }
        }
    }

    return trimTrailingSpaces(chars.join(""));
}

// ─── Private: Folding Helpers ───────────────────────────────

/**
 * Parses folding track lines into an array of IFoldingRegion.
 * Symbols: 'v' = expanded start, '>' = collapsed start, '|' = body, '^' = end.
 * The first non-space character of the folding track determines the role of the line.
 */
function parseFoldingTracks(foldingTrackByLine: Map<number, string>): IFoldingRegion[] {
    const regions: IFoldingRegion[] = [];

    // Collect starts: lines with 'v' or '>'
    const starts: { line: number; collapsed: boolean }[] = [];
    for (const [lineIdx, track] of foldingTrackByLine) {
        const ch = track.trim().charAt(0);
        if (ch === FOLD_EXPANDED_START) {
            starts.push({ line: lineIdx, collapsed: false });
        } else if (ch === FOLD_COLLAPSED_START) {
            starts.push({ line: lineIdx, collapsed: true });
        }
    }

    // Sort starts by line number
    starts.sort((a, b) => a.line - b.line);

    // For each start, find matching '^' end
    // Use a stack for nested regions
    const stack: { line: number; collapsed: boolean }[] = [];
    const sortedLines = [...foldingTrackByLine.entries()].sort(([a], [b]) => a - b);

    for (const [lineIdx, track] of sortedLines) {
        const ch = track.trim().charAt(0);
        if (ch === FOLD_EXPANDED_START || ch === FOLD_COLLAPSED_START) {
            stack.push({ line: lineIdx, collapsed: ch === FOLD_COLLAPSED_START });
        } else if (ch === FOLD_END) {
            if (stack.length > 0) {
                /* v8 ignore start -- defensive: guarded by `stack.length > 0`, so pop() always returns a value and reject() is unreachable */
                const start = stack.pop() ?? reject();
                /* v8 ignore stop */
                regions.push(createFoldingRegion(start.line, lineIdx, start.collapsed));
            }
        }
    }

    // Sort regions by startLine
    regions.sort((a, b) => a.startLine - b.startLine);
    return regions;
}

/**
 * Renders the folding character for a given document line, or null if no folding.
 */
function renderFoldingChar(foldedRegions: readonly IFoldingRegion[], lineIdx: number): string | null {
    for (const region of foldedRegions) {
        if (region.startLine === lineIdx) {
            return region.isCollapsed ? FOLD_COLLAPSED_START : FOLD_EXPANDED_START;
        }
        if (region.endLine === lineIdx) {
            return FOLD_END;
        }
        if (lineIdx > region.startLine && lineIdx < region.endLine) {
            return FOLD_BODY;
        }
    }
    return null;
}

// ─── Private: String Utilities ──────────────────────────────

function dedentAndTrim(text: string): string {
    const lines = text.split("\n");

    // Remove leading and trailing blank lines
    while (lines.length > 0 && lines[0].trim() === "") {
        lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
        lines.pop();
    }

    // Find minimum indentation
    let minIndent = Infinity;
    for (const line of lines) {
        if (line.trim() === "") continue;
        const indent = line.length - line.trimStart().length;
        minIndent = Math.min(minIndent, indent);
    }

    if (minIndent === Infinity) {
        minIndent = 0;
    }

    // Remove common indentation
    return lines.map((line) => line.substring(minIndent)).join("\n");
}

function trimTrailingSpaces(s: string): string {
    return s.replace(/\s+$/, "");
}
