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

/** A space ("no token") is color 0. */
function trackToken(ch: string): number {
    return ((ch === " " ? 0 : ch.charCodeAt(0)) << MetadataConsts.FOREGROUND_OFFSET) >>> 0;
}

function trackTokens(tokens: LineTokens | undefined): [number, string][] | undefined {
    if (tokens === undefined) return undefined;
    const result: [number, string][] = [];
    for (let i = 0; i < tokens.getCount(); i++) {
        const foreground = TokenMetadata.getForeground(tokens.getMetadata(i));
        result.push([tokens.getStartOffset(i), foreground === ColorId.None ? " " : String.fromCharCode(foreground)]);
    }
    return result;
}

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

    it("parses a forward selection on one line", () => {
        const dsl = editorState`
            text: hello world
            cursor:            █
            select:       ░░░░░
        `;
        const state = parseDSL(dsl);
        expect(state.selections).toHaveLength(1);
        const sel = state.selections[0];
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
        expect(sel.anchor).toEqual({ line: 0, character: 5 });
        expect(sel.active).toEqual({ line: 0, character: 0 });
    });

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

    it("handles empty text line", () => {
        const dsl = editorState`
            text:${" "}
            cursor: █
        `;
        const state = parseDSL(dsl);
        expect(state.document.getText()).toBe("");
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("editorState tag dedents and trims", () => {
        const result = editorState`
            text: hello
            cursor: █
        `;
        expect(result).toBe("text: hello\ncursor: █");
    });

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
        expect(rendered).toBe(dsl);
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
        const sorted = [...state.foldedRegions].sort((a, b) => a.startLine - b.startLine);
        expect(sorted[0]).toEqual({ startLine: 0, endLine: 4, isCollapsed: false });
        expect(sorted[1]).toEqual({ startLine: 1, endLine: 3, isCollapsed: false });
    });

    it("renders a select track for a single-line selection", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createSelection(0, 6, 0, 11)]);

        const rendered = renderToDSL(state);

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
        const doc = new TextDocument("aaaa\nbbbb\ncccc");
        const state = new EditorViewState(doc, [createSelection(0, 2, 2, 1)]);

        const rendered = renderToDSL(state);
        const lines = rendered.split("\n");

        expect(lines).toContain("select:   ░░");
        expect(lines).toContain("select: ░░░░");
    });

    it("renders a selection whose end character exceeds the line content length", () => {
        // Covers the select-track renderer growing its buffer via chars.push.
        const doc = new TextDocument("ab");
        const state = new EditorViewState(doc, [createSelection(0, 0, 0, 5)]);

        const rendered = renderToDSL(state);
        const lines = rendered.split("\n");

        const selectLine = lines.find((l) => l.startsWith("select:"));
        expect(selectLine).toBeDefined();
        expect(selectLine).toBe("select: ░░░░░");
    });

    it("parses a select track that has no accompanying cursor as a forward selection", () => {
        const state = parseDSL(editorState`
            text: hello world
            select:       ░░░░░
        `);
        expect(state.selections).toHaveLength(1);
        const sel = state.selections[0];
        expect(sel.anchor).toEqual({ line: 0, character: 6 });
        expect(sel.active).toEqual({ line: 0, character: 11 });
    });

    it("parses an empty tokens track as no tokens", () => {
        const state = parseDSL(editorState`
            text: hello
            tokens:${""}
        `);
        expect(state.tokenStore?.getLineTokens(0)).toBeUndefined();
    });

    it("a tokens track of only spaces is no tokens — the store is not created", () => {
        const state = parseDSL(editorState`
            text: hello
            tokens:   ${""}
        `);
        expect(state.tokenStore).toBeUndefined();
    });

    it("editorState of an all-blank template yields an empty string", () => {
        // All lines blank → minIndent stays Infinity and is reset to 0.
        const result = editorState`



        `;
        expect(result).toBe("");
    });

    it("parses track content that omits the leading separator space", () => {
        // Covers the `startsWith(" ")` false branch of every track prefix.
        const dsl = ["text:ab", "cursor:█", "tokens:kk", "folding:v", "text:b", "folding:^"].join("\n");
        const state = parseDSL(dsl);
        expect(state.document.getLineContent(0)).toBe("ab");
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
        expect(trackTokens(state.tokenStore?.getLineTokens(0))).toEqual([[0, "k"]]);
        expect(state.foldedRegions).toHaveLength(1);
        expect(state.foldedRegions[0]).toEqual({ startLine: 0, endLine: 1, isCollapsed: false });
    });

    it("parses a select track without the leading separator space", () => {
        const dsl = ["text:hello", "select:░░░"].join("\n");
        const state = parseDSL(dsl);
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
    });

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

    it("ignores an unmatched folding end (^ with an empty stack)", () => {
        const state = parseDSL(["text: a", "folding: ^", "text: b"].join("\n"));
        expect(state.foldedRegions).toHaveLength(0);
    });

    it("renders no folding char for a line that sits before any region", () => {
        // Covers the `lineIdx > startLine` false branch of renderFoldingChar's body check.
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

    it("renders a tokens track whose last token runs to the end of the line", () => {
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
        // The `n` tokens start at column 3, past the 3-character line.
        const state = parseDSL(["text: abc", "tokens: kkknn"].join("\n"));
        expect(trackTokens(state.tokenStore?.getLineTokens(0))).toEqual([[0, "k"]]);

        const rendered = renderToDSL(state);
        const tokensLine = rendered.split("\n").find((l) => l.startsWith("tokens:"));
        expect(tokensLine).toBe("tokens: kkk");
    });

    it("renders no select track for a line above a multi-line selection", () => {
        const doc = new TextDocument("aaaa\nbbbb\ncccc");
        const state = new EditorViewState(doc, [createSelection(1, 0, 2, 2)]);

        const rendered = renderToDSL(state);
        const lines = rendered.split("\n");
        expect(lines[0]).toBe("text: aaaa");
        expect(lines[1]).not.toMatch(/^select:/);
    });

    it("ignores lines that match no track prefix", () => {
        const dsl = ["text: hello", "# just a comment line", "text: world"].join("\n");
        const state = parseDSL(dsl);
        expect(state.document.lineCount).toBe(2);
        expect(state.document.getLineContent(0)).toBe("hello");
        expect(state.document.getLineContent(1)).toBe("world");
    });

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

    it("dedents while skipping an internal blank line", () => {
        const result = editorState`
            text: a

            text: b
        `;
        expect(result).toBe("text: a\n\ntext: b");
    });
});
