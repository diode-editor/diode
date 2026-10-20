import { describe, expect, it } from "vitest";

import { storedTokens } from "../../../../TestUtils/encodedTokens.ts";
import { createCursorSelection, createSelection } from "../../common/core/iSelection.ts";
import { ColorId, MetadataConsts, TokenMetadata } from "../../common/encodedTokenAttributes.ts";
import { PlainTextTokenizer } from "../../common/languages/builtin/plainTextTokenizer.ts";
import { TextDocument } from "../../common/model/textDocument.ts";
import { DocumentTokenStore } from "../../common/tokens/documentTokenStore.ts";
import type { LineTokens } from "../../common/tokens/lineTokens.ts";
import { EditorViewState } from "../../common/viewModel/editorViewState.ts";
import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";

import { editorState, expectEditorState, parseDSL, renderToDSL } from "./trackDSL.ts";

/** Метаданные токена символа трека: цвет текста — код символа, пробел («нет токена») — цвет 0. */
function trackToken(ch: string): number {
    return ((ch === " " ? 0 : ch.charCodeAt(0)) << MetadataConsts.FOREGROUND_OFFSET) >>> 0;
}

/** Токены строки → пары «начало, символ трека». */
function trackTokens(tokens: LineTokens | undefined): [number, string][] | undefined {
    if (tokens === undefined) return undefined;
    const result: [number, string][] = [];
    for (let i = 0; i < tokens.getCount(); i++) {
        const foreground = TokenMetadata.getForeground(tokens.getMetadata(i));
        result.push([tokens.getStartOffset(i), foreground === ColorId.None ? " " : String.fromCharCode(foreground)]);
    }
    return result;
}

// ─── Roundtrip ──────────────────────────────────────────────

describe("TrackDSL", () => {
    it("roundtrips simple text without cursor", () => {
        const dsl = editorState`
            text: hello world
        `;
        const state = parseDSL(dsl);
        expect(state.document.getText()).toBe("hello world");
    });

    it("roundtrips text with a cursor", () => {
        const dsl = editorState`
            text: hello
            cursor:     █
        `;
        const state = parseDSL(dsl);
        expect(state.document.getText()).toBe("hello");
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });

        const rendered = renderToDSL(state);
        expect(rendered).toBe(dsl);
    });

    it("roundtrips multi-line text with cursor", () => {
        const dsl = editorState`
            text: hello
            text: world
            cursor: █
        `;
        const state = parseDSL(dsl);
        expect(state.document.lineCount).toBe(2);
        expect(state.document.getLineContent(0)).toBe("hello");
        expect(state.document.getLineContent(1)).toBe("world");
        expect(state.selections[0].active).toEqual({ line: 1, character: 0 });

        const rendered = renderToDSL(state);
        expect(rendered).toBe(dsl);
    });

    it("roundtrips cursor at end of line", () => {
        const dsl = editorState`
            text: hello
            cursor:      █
        `;
        const state = parseDSL(dsl);
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });

        const rendered = renderToDSL(state);
        expect(rendered).toBe(dsl);
    });

    // ─── Multiple Cursors ───────────────────────────────────

    it("parses multiple cursors on different lines", () => {
        const dsl = editorState`
            text: aaa
            cursor: █
            text: bbb
            cursor: █
        `;
        const state = parseDSL(dsl);
        expect(state.selections).toHaveLength(2);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
        expect(state.selections[1].active).toEqual({ line: 1, character: 0 });

        const rendered = renderToDSL(state);
        expect(rendered).toBe(dsl);
    });

    // ─── Selections ─────────────────────────────────────────

    it("parses a forward selection on one line", () => {
        const dsl = editorState`
            text: hello world
            cursor:            █
            select:       ░░░░░
        `;
        const state = parseDSL(dsl);
        expect(state.selections).toHaveLength(1);
        const sel = state.selections[0];
        // Forward: anchor at start, active at end (cursor)
        expect(sel.anchor).toEqual({ line: 0, character: 6 });
        expect(sel.active).toEqual({ line: 0, character: 11 });
    });

    it("parses a backward selection on one line", () => {
        const dsl = editorState`
            text: hello world
            cursor: █
            select: ░░░░░
        `;
        const state = parseDSL(dsl);
        expect(state.selections).toHaveLength(1);
        const sel = state.selections[0];
        // Backward: anchor at end of selection, active at cursor (start)
        expect(sel.anchor).toEqual({ line: 0, character: 5 });
        expect(sel.active).toEqual({ line: 0, character: 0 });
    });

    // ─── Tokens ─────────────────────────────────────────────

    it("parses and renders token tracks", () => {
        const dsl = editorState`
            text: let x = 5
            cursor: █
            tokens: kkkbbbbnn
        `;
        const state = parseDSL(dsl);
        const tokens = state.tokenStore?.getLineTokens(0);
        expect(tokens).toBeDefined();
        expect(trackTokens(tokens)).toEqual([
            [0, "k"],
            [3, "b"],
            [7, "n"],
        ]);

        const rendered = renderToDSL(state);
        expect(rendered).toBe(dsl);
    });

    it("parses tokens with spaces (no token → token with foreground 0)", () => {
        const dsl = editorState`
            text: ab cd
            tokens: kk nn
        `;
        const state = parseDSL(dsl);
        const tokens = state.tokenStore?.getLineTokens(0);
        expect(tokens).toBeDefined();
        // Binary tokens have no gaps: the space becomes its own token with foreground 0.
        expect(trackTokens(tokens)).toEqual([
            [0, "k"],
            [2, " "],
            [3, "n"],
        ]);
    });

    it("roundtrips complex state with all tracks", () => {
        const dsl = editorState`
            text: let x = 5
            cursor:     █
            tokens: kkkbbbbnn
            text: return x
            tokens: kkkkkkkb
        `;
        const state = parseDSL(dsl);
        expect(state.document.lineCount).toBe(2);
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
        expect(state.tokenStore?.getLineTokens(0)).toBeDefined();
        expect(state.tokenStore?.getLineTokens(1)).toBeDefined();

        const rendered = renderToDSL(state);
        expect(rendered).toBe(dsl);
    });

    // ─── Empty Document ─────────────────────────────────────

    it("handles empty text line", () => {
        const dsl = editorState`
            text:${" "}
            cursor: █
        `;
        const state = parseDSL(dsl);
        expect(state.document.getText()).toBe("");
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    // ─── Tagged Template ────────────────────────────────────

    it("editorState tag dedents and trims", () => {
        const result = editorState`
            text: hello
            cursor: █
        `;
        expect(result).toBe("text: hello\ncursor: █");
    });

    // ─── expectEditorState ──────────────────────────────────

    it("expectEditorState passes on matching state", () => {
        const state = parseDSL(editorState`
            text: hello
            cursor:      █
        `);
        expectEditorState(
            state,
            `
            text: hello
            cursor:      █
        `,
        );
    });

    // ─── Integration: DSL → type() → DSL ────────────────────

    it("type a character and verify with DSL", () => {
        const state = parseDSL(editorState`
            text: hllo
            cursor:  █
        `);
        state.type("e");
        expectEditorState(
            state,
            `
            text: hello
            cursor:   █
        `,
        );
    });

    it("multi-cursor type and verify with DSL", () => {
        const state = parseDSL(editorState`
            text: aaa
            cursor: █
            text: bbb
            cursor: █
        `);
        state.type("X");
        expectEditorState(
            state,
            `
            text: Xaaa
            cursor:  █
            text: Xbbb
            cursor:  █
        `,
        );
    });

    it("type with newline and verify with DSL", () => {
        const state = parseDSL(editorState`
            text: helloworld
            cursor:      █
        `);
        state.insertNewLine();
        expectEditorState(
            state,
            `
            text: hello
            text: world
            cursor: █
        `,
        );
    });

    it("deleteLeft and verify with DSL", () => {
        const state = parseDSL(editorState`
            text: helllo
            cursor:    █
        `);
        state.deleteLeft();
        expectEditorState(
            state,
            `
            text: hello
            cursor:   █
        `,
        );
    });

    // ─── Folding Track ──────────────────────────────────────

    it("parses expanded folding region with v/|/^", () => {
        const state = parseDSL(editorState`
            text: function foo() {
            folding: v
            text:   console.log(1);
            folding: |
            text: }
            folding: ^
        `);
        expect(state.foldedRegions).toHaveLength(1);
        expect(state.foldedRegions[0]).toEqual({
            startLine: 0,
            endLine: 2,
            isCollapsed: false,
        });
    });

    it("parses collapsed folding region with >/|/^", () => {
        const state = parseDSL(editorState`
            text: function foo() {
            folding: >
            text:   console.log(1);
            folding: |
            text: }
            folding: ^
        `);
        expect(state.foldedRegions).toHaveLength(1);
        expect(state.foldedRegions[0]).toEqual({
            startLine: 0,
            endLine: 2,
            isCollapsed: true,
        });
    });

    it("parses multiple folding regions", () => {
        const state = parseDSL(editorState`
            text: a
            folding: v
            text: b
            folding: ^
            text: c
            folding: >
            text: d
            folding: ^
        `);
        expect(state.foldedRegions).toHaveLength(2);
        expect(state.foldedRegions[0]).toEqual({ startLine: 0, endLine: 1, isCollapsed: false });
        expect(state.foldedRegions[1]).toEqual({ startLine: 2, endLine: 3, isCollapsed: true });
    });

    it("roundtrips folding track with expanded region", () => {
        const dsl = editorState`
            text: a
            cursor: █
            folding: v
            text: b
            folding: |
            text: c
            folding: ^
        `;
        const state = parseDSL(dsl);
        const rendered = renderToDSL(state);
        expect(rendered).toBe(dsl);
    });

    it("roundtrips folding track with collapsed region", () => {
        const dsl = editorState`
            text: a
            cursor: █
            folding: >
            text: b
            folding: |
            text: c
            folding: ^
        `;
        const state = parseDSL(dsl);
        const rendered = renderToDSL(state);
        expect(rendered).toBe(dsl);
    });

    it("renders state with no folding regions (no folding track)", () => {
        const dsl = editorState`
            text: hello
            cursor: █
        `;
        const state = parseDSL(dsl);
        const rendered = renderToDSL(state);
        expect(rendered).toBe(dsl); // no folding: lines
    });

    it("parses nested folding regions", () => {
        const state = parseDSL(editorState`
            text: outer start
            folding: v
            text:   inner start
            folding: v
            text:     body
            folding: |
            text:   inner end
            folding: ^
            text: outer end
            folding: ^
        `);
        expect(state.foldedRegions).toHaveLength(2);
        // Stack-based parsing: inner closes first, outer closes second
        // Sorted by startLine, inner (1-3) comes first, outer (0-4) comes second
        const sorted = [...state.foldedRegions].sort((a, b) => a.startLine - b.startLine);
        expect(sorted[0]).toEqual({ startLine: 0, endLine: 4, isCollapsed: false });
        expect(sorted[1]).toEqual({ startLine: 1, endLine: 3, isCollapsed: false });
    });

    // ─── Select track rendering ─────────────────────────────

    it("renders a select track for a single-line selection", () => {
        // Build a state with a forward selection covering "world" in "hello world".
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createSelection(0, 6, 0, 11)]);

        const rendered = renderToDSL(state);

        // The select track marks columns 6..11 with ░ and the cursor sits at 11.
        expect(rendered).toBe(["text: hello world", "cursor:            █", "select:       ░░░░░"].join("\n"));
    });

    it("round-trips a single-line selection through parse and render", () => {
        const dsl = editorState`
            text: hello world
            cursor:            █
            select:       ░░░░░
        `;
        const state = parseDSL(dsl);
        expect(renderToDSL(state)).toBe(dsl);
    });

    it("renders a multi-line selection filling whole intermediate lines", () => {
        // Selection spans from line 0 col 2 to line 2 col 1. The middle line
        // is filled from col 0 to its full content length.
        const doc = new TextDocument("aaaa\nbbbb\ncccc");
        const state = new EditorViewState(doc, [createSelection(0, 2, 2, 1)]);

        const rendered = renderToDSL(state);
        const lines = rendered.split("\n");

        // Line 0: ░ starts at col 2.
        expect(lines).toContain("select:   ░░");
        // Middle line (line 1) is fully selected — 4 ░.
        expect(lines).toContain("select: ░░░░");
    });

    it("renders a selection whose end character exceeds the line content length", () => {
        // The active end sits past the end of the short line "ab" (length 2).
        // The select-track renderer grows the char buffer via chars.push to mark
        // those out-of-content columns.
        const doc = new TextDocument("ab");
        const state = new EditorViewState(doc, [createSelection(0, 0, 0, 5)]);

        const rendered = renderToDSL(state);
        const lines = rendered.split("\n");

        const selectLine = lines.find((l) => l.startsWith("select:"));
        expect(selectLine).toBeDefined();
        // 5 ░ characters — extended two columns beyond the 2-char line content.
        expect(selectLine).toBe("select: ░░░░░");
    });

    // ─── Selection without a cursor track ───────────────────

    it("parses a select track that has no accompanying cursor as a forward selection", () => {
        const state = parseDSL(editorState`
            text: hello world
            select:       ░░░░░
        `);
        expect(state.selections).toHaveLength(1);
        const sel = state.selections[0];
        // No cursor → anchor at start, active at end of the ░ run.
        expect(sel.anchor).toEqual({ line: 0, character: 6 });
        expect(sel.active).toEqual({ line: 0, character: 11 });
    });

    // ─── Empty token track ──────────────────────────────────

    it("parses an empty tokens track as no tokens", () => {
        // The tokens track is present but empty after the prefix → no tokens.
        const state = parseDSL(editorState`
            text: hello
            tokens:${""}
        `);
        // Empty token list → store not created, so no tokens for line 0.
        expect(state.tokenStore?.getLineTokens(0)).toBeUndefined();
    });

    // ─── dedentAndTrim with only blank lines ────────────────

    it("editorState of an all-blank template yields an empty string", () => {
        // All lines blank → minIndent stays Infinity and is reset to 0.
        const result = editorState`



        `;
        expect(result).toBe("");
    });

    // ─── Track content without the leading separator space ──────

    it("parses track content that omits the leading separator space", () => {
        // No space after the colon on any track → the `startsWith(" ")` false branch
        // of every track prefix (text/cursor/select/tokens/folding) is exercised.
        const dsl = ["text:ab", "cursor:█", "tokens:kk", "folding:v", "text:b", "folding:^"].join("\n");
        const state = parseDSL(dsl);
        expect(state.document.getLineContent(0)).toBe("ab");
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
        expect(trackTokens(state.tokenStore?.getLineTokens(0))).toEqual([[0, "k"]]);
        expect(state.foldedRegions).toHaveLength(1);
        expect(state.foldedRegions[0]).toEqual({ startLine: 0, endLine: 1, isCollapsed: false });
    });

    it("parses a select track without the leading separator space", () => {
        // "select:░░░" → after the prefix the content starts with ░ (no space to strip).
        const dsl = ["text:hello", "select:░░░"].join("\n");
        const state = parseDSL(dsl);
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
    });

    // ─── Tokens track beginning with a "no token" space ─────────

    it("parses a tokens track whose first column is empty (leading space = no token)", () => {
        // Two leading spaces: one is the separator, the second makes track[0] === " ",
        // so the very first column carries no token (a foreground-0 token).
        const dsl = ["text: abc", "tokens:  nn"].join("\n");
        const state = parseDSL(dsl);
        expect(trackTokens(state.tokenStore?.getLineTokens(0))).toEqual([
            [0, " "],
            [1, "n"],
        ]);
    });

    // ─── Folding: unmatched end + render before region ──────────

    it("ignores an unmatched folding end (^ with an empty stack)", () => {
        // A standalone '^' with no preceding 'v'/'>' → the `stack.length > 0` guard fails
        // and the end is dropped instead of producing a region.
        const state = parseDSL(["text: a", "folding: ^", "text: b"].join("\n"));
        expect(state.foldedRegions).toHaveLength(0);
    });

    it("renders no folding char for a line that sits before any region", () => {
        // Region spans lines 1..2; line 0 is before it, so renderFoldingChar reaches the
        // body check with `lineIdx < region.startLine` (the `lineIdx > startLine` false branch)
        // and returns null.
        const doc = new TextDocument("a\nb\nc");
        const state = new EditorViewState(doc);
        state.setFoldingRegions([createFoldingRegion(1, 2, false)]);

        const rendered = renderToDSL(state);
        const lines = rendered.split("\n");
        expect(lines[0]).toBe("text: a");
        expect(lines[1]).not.toMatch(/^folding:/); // line 0 carries no folding track
        expect(rendered).toContain("folding: v");
        expect(rendered).toContain("folding: ^");
    });

    // ─── Tokens render: last token + token past line content ────

    it("renders a tokens track whose last token runs to the end of the line", () => {
        // Three tokens; the final one has no following token, so its end is the line length.
        const doc = new TextDocument("abcdef");
        const state = new EditorViewState(doc);
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.setLineTokens(
            0,
            storedTokens(
                [
                    [0, trackToken("k")],
                    [2, trackToken("b")],
                    [4, trackToken("n")],
                ],
                6,
            ),
        );
        state.tokenStore = store;

        const rendered = renderToDSL(state);
        expect(rendered).toContain("tokens: kkbbnn");
    });

    it("clips a tokens track that runs past the line content length", () => {
        // The `n` tokens start at column 3 but the line only has 3 characters: the
        // parser clips the track to the line, so only the `k` token survives.
        const state = parseDSL(["text: abc", "tokens: kkknn"].join("\n"));
        expect(trackTokens(state.tokenStore?.getLineTokens(0))).toEqual([[0, "k"]]);

        const rendered = renderToDSL(state);
        const tokensLine = rendered.split("\n").find((l) => l.startsWith("tokens:"));
        expect(tokensLine).toBe("tokens: kkk");
    });

    // ─── Select render: line before a multi-line selection ──────

    it("renders no select track for a line above a multi-line selection", () => {
        // Selection spans lines 1..2; line 0 is above it, exercising the
        // `range.start.line > lineIdx` true branch (the line is skipped).
        const doc = new TextDocument("aaaa\nbbbb\ncccc");
        const state = new EditorViewState(doc, [createSelection(1, 0, 2, 2)]);

        const rendered = renderToDSL(state);
        const lines = rendered.split("\n");
        expect(lines[0]).toBe("text: aaaa");
        expect(lines[1]).not.toMatch(/^select:/);
    });

    // ─── Unrecognized lines are ignored ─────────────────────────

    it("ignores lines that match no track prefix", () => {
        // The middle line is neither text/cursor/select/tokens/folding, so it falls through
        // the whole if/else-if chain (the folding `else if` false branch) and is skipped.
        const dsl = ["text: hello", "# just a comment line", "text: world"].join("\n");
        const state = parseDSL(dsl);
        expect(state.document.lineCount).toBe(2);
        expect(state.document.getLineContent(0)).toBe("hello");
        expect(state.document.getLineContent(1)).toBe("world");
    });

    // ─── Token with foreground 0 renders as a space ──────────────

    it("renders a token with foreground 0 as a blank column", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc);
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.setLineTokens(
            0,
            storedTokens(
                [
                    [0, trackToken("k")],
                    [1, trackToken(" ")],
                    [2, trackToken("n")],
                ],
                3,
            ),
        );
        state.tokenStore = store;

        const tokensLine = renderToDSL(state)
            .split("\n")
            .find((l) => l.startsWith("tokens:"));
        expect(tokensLine).toBe("tokens: k n");
    });

    it("renders no tokens track when the whole line is a single foreground-0 token", () => {
        // All spaces → trimmed to nothing → the track is omitted, matching the parser,
        // which reads a blank track as "no tokens".
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc);
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.setLineTokens(0, storedTokens([[0, trackToken(" ")]], 3));
        state.tokenStore = store;

        expect(renderToDSL(state)).not.toContain("tokens:");
    });

    // ─── dedent with an internal blank line ─────────────────────

    it("dedents while skipping an internal blank line", () => {
        // The blank middle line is skipped when computing minIndent (line.trim() === "")
        // but preserved (as empty) in the output.
        const result = editorState`
            text: a

            text: b
        `;
        expect(result).toBe("text: a\n\ntext: b");
    });
});
