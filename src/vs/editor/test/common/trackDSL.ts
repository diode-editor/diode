import { reject } from "@tuidom/core/common/typingUtils";
import { expect } from "vitest";

import { storedTokens } from "../../../../TestUtils/encodedTokens.ts";
import { comparePositions } from "../../common/core/iPosition.ts";
import type { ISelection } from "../../common/core/iSelection.ts";
import {
    createCursorSelection,
    createSelection,
    isSelectionCollapsed,
    selectionToRange,
} from "../../common/core/iSelection.ts";
import { MetadataConsts, TokenMetadata } from "../../common/encodedTokenAttributes.ts";
import { PlainTextTokenizer } from "../../common/languages/builtin/plainTextTokenizer.ts";
import { TextDocument } from "../../common/model/textDocument.ts";
import { DocumentTokenStore } from "../../common/tokens/documentTokenStore.ts";
import type { LineTokens } from "../../common/tokens/lineTokens.ts";
import { EditorViewState } from "../../common/viewModel/editorViewState.ts";
import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";

const CURSOR_CHAR = "█";
const SELECT_CHAR = "░";

const TRACK_PREFIX_TEXT = "text:";
const TRACK_PREFIX_CURSOR = "cursor:";
const TRACK_PREFIX_SELECT = "select:";
const TRACK_PREFIX_TOKENS = "tokens:";
const TRACK_PREFIX_FOLDING = "folding:";

const FOLD_EXPANDED_START = "v";
const FOLD_COLLAPSED_START = ">";
const FOLD_BODY = "|";
const FOLD_END = "^";

export function editorState(strings: TemplateStringsArray, ...values: unknown[]): string {
    const raw = String.raw(strings, ...values);
    return dedentAndTrim(raw);
}

/**
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

    const documentText = textLines.join("\n");
    const doc = new TextDocument(documentText);

    const selections: ISelection[] = [];

    for (const [lineIdx, track] of cursorTrackByLine) {
        const selectTrack = selectTrackByLine.get(lineIdx);
        for (let i = 0; i < track.length; i++) {
            if (track[i] === CURSOR_CHAR) {
                if (selectTrack) {
                    continue;
                }
                selections.push(createCursorSelection(lineIdx, i));
            }
        }
    }

    parseSelections(cursorTrackByLine, selectTrackByLine, textLines, selections);

    // PlainTextTokenizer is a stub: tokens are set from outside via setLineTokens.
    let tokenStore: DocumentTokenStore | undefined;
    for (const [lineIdx, track] of tokensTrackByLine) {
        const tokens = parseTokenTrack(track, doc.getLineContent(lineIdx).length);
        if (tokens !== undefined) {
            tokenStore ??= new DocumentTokenStore(doc, new PlainTextTokenizer());
            tokenStore.setLineTokens(lineIdx, tokens);
        }
    }

    selections.sort((a, b) => comparePositions(a.active, b.active));

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

export function renderToDSL(state: EditorViewState): string {
    const doc = state.document;
    const lines: string[] = [];

    for (let lineIdx = 0; lineIdx < doc.lineCount; lineIdx++) {
        const textContent = doc.getLineContent(lineIdx);
        lines.push(`${TRACK_PREFIX_TEXT} ${textContent}`);

        const cursorTrack = renderCursorTrack(state.selections, lineIdx, textContent.length);
        if (cursorTrack !== null) {
            lines.push(`${TRACK_PREFIX_CURSOR} ${cursorTrack}`);
        }

        const selectTrack = renderSelectTrack(state.selections, lineIdx, textContent.length);
        if (selectTrack !== null) {
            lines.push(`${TRACK_PREFIX_SELECT} ${selectTrack}`);
        }

        const tokens = state.tokenStore?.getLineTokens(lineIdx);
        const tokensTrack = tokens === undefined ? "" : renderTokensTrack(tokens);
        if (tokensTrack !== "") {
            lines.push(`${TRACK_PREFIX_TOKENS} ${tokensTrack}`);
        }

        const foldingChar = renderFoldingChar(state.foldedRegions, lineIdx);
        if (foldingChar !== null) {
            lines.push(`${TRACK_PREFIX_FOLDING} ${foldingChar}`);
        }
    }

    return lines.join("\n");
}

export function expectEditorState(state: EditorViewState, expected: string): void {
    const actual = renderToDSL(state);
    const normalizedExpected = dedentAndTrim(expected);
    expect(actual).toBe(normalizedExpected);
}

function parseSelections(
    cursorTrackByLine: Map<number, string>,
    selectTrackByLine: Map<number, string>,
    textLines: string[],
    selections: ISelection[],
): void {
    // Each contiguous run of ░ on a single line is one selection; █ marks the active end.
    for (const [lineIdx, selectTrack] of selectTrackByLine) {
        const cursorTrack = cursorTrackByLine.get(lineIdx);
        let i = 0;
        while (i < selectTrack.length) {
            if (selectTrack[i] === SELECT_CHAR) {
                const selectStart = i;
                while (i < selectTrack.length && selectTrack[i] === SELECT_CHAR) {
                    i++;
                }
                const selectEnd = i;

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
                    if (cursorPos <= selectStart) {
                        selections.push(createSelection(lineIdx, selectEnd, lineIdx, cursorPos));
                    } else {
                        selections.push(createSelection(lineIdx, selectStart, lineIdx, cursorPos));
                    }
                } else {
                    selections.push(createSelection(lineIdx, selectStart, lineIdx, selectEnd));
                }
            } else {
                i++;
            }
        }
    }
}

/** A track character is encoded as the color index (`foreground` = char code); the last token extends to line end. */
function parseTokenTrack(track: string, lineLength: number): Uint32Array | undefined {
    const starts: [number, number][] = [];
    for (let i = 0; i < Math.min(track.length, lineLength); i++) {
        if (track[i] !== track[i - 1]) starts.push([i, trackCharMetadata(track[i])]);
    }
    if (starts.every(([, metadata]) => metadata === trackCharMetadata(" "))) return undefined;
    return storedTokens(starts, lineLength);
}

function trackCharMetadata(ch: string): number {
    return (ch.charCodeAt(0) << MetadataConsts.FOREGROUND_OFFSET) >>> 0;
}

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

function renderTokensTrack(tokens: LineTokens): string {
    const chars: string[] = [];
    tokens.forEach((i) => {
        const foreground: number = TokenMetadata.getForeground(tokens.getMetadata(i));
        // Color 0 is a token without a color (not from the track): a space.
        const ch = foreground === 0 ? " " : String.fromCharCode(foreground);
        for (let c = tokens.getStartOffset(i); c < tokens.getEndOffset(i); c++) chars.push(ch);
    });
    return trimTrailingSpaces(chars.join(""));
}

/** The first non-space character of the folding track determines the role of the line. */
function parseFoldingTracks(foldingTrackByLine: Map<number, string>): IFoldingRegion[] {
    const regions: IFoldingRegion[] = [];

    const starts: { line: number; collapsed: boolean }[] = [];
    for (const [lineIdx, track] of foldingTrackByLine) {
        const ch = track.trim().charAt(0);
        if (ch === FOLD_EXPANDED_START) {
            starts.push({ line: lineIdx, collapsed: false });
        } else if (ch === FOLD_COLLAPSED_START) {
            starts.push({ line: lineIdx, collapsed: true });
        }
    }

    starts.sort((a, b) => a.line - b.line);

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

    regions.sort((a, b) => a.startLine - b.startLine);
    return regions;
}

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

function dedentAndTrim(text: string): string {
    const lines = text.split("\n");

    while (lines.length > 0 && lines[0].trim() === "") {
        lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
        lines.pop();
    }

    let minIndent = Infinity;
    for (const line of lines) {
        if (line.trim() === "") continue;
        const indent = line.length - line.trimStart().length;
        minIndent = Math.min(minIndent, indent);
    }

    if (minIndent === Infinity) {
        minIndent = 0;
    }

    return lines.map((line) => line.substring(minIndent)).join("\n");
}

function trimTrailingSpaces(s: string): string {
    return s.replace(/\s+$/, "");
}
