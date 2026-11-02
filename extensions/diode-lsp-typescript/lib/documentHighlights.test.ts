import { describe, expect, it } from "vitest";

import { highlightsFromTsserver } from "./documentHighlights.ts";

const span = (line: number, offset: number, kind: string) => ({
    start: { line, offset },
    end: { line, offset: offset + 1 },
    kind,
});

describe("diode-lsp-typescript — document highlights from tsserver", () => {
    it("only writtenReference is a write, like upstream", () => {
        const answer = highlightsFromTsserver({
            type: "response",
            body: [
                {
                    file: "/w/a.ts",
                    highlightSpans: [span(1, 5, "writtenReference"), span(2, 3, "reference"), span(3, 1, "definition")],
                },
            ],
        });
        expect(answer).toEqual([
            { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 5, isWrite: true },
            { startLine: 1, startCharacter: 2, endLine: 1, endCharacter: 3, isWrite: false },
            { startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 1, isWrite: false },
        ]);
    });

    it("an empty body is an answer, a missing one leaves it to the stock request", () => {
        expect(highlightsFromTsserver({ type: "response", body: [] })).toEqual([]);
        expect(highlightsFromTsserver({ type: "response" })).toBeUndefined();
        expect(highlightsFromTsserver(null)).toBeUndefined();
    });
});
