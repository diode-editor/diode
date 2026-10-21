import { describe, expect, it } from "vitest";

import {
    Position,
    Range,
    SemanticTokens,
    SemanticTokensBuilder,
    SemanticTokensEdit,
    SemanticTokensEdits,
    SemanticTokensLegend,
} from "./vscodeTypes.ts";

const LEGEND = new SemanticTokensLegend(["class", "variable", "function"], ["declaration", "readonly", "static"]);

describe("SemanticTokensLegend", () => {
    it("stores types and modifiers; no modifiers gives an empty list", () => {
        expect(LEGEND.tokenTypes).toEqual(["class", "variable", "function"]);
        expect(LEGEND.tokenModifiers).toEqual(["declaration", "readonly", "static"]);
        expect(new SemanticTokensLegend(["a"]).tokenModifiers).toEqual([]);
    });
});

describe("SemanticTokensBuilder — numeric overload", () => {
    it("ordered pushes are delta-encoded by line and character", () => {
        const builder = new SemanticTokensBuilder();
        builder.push(1, 2, 3, 0, 1);
        builder.push(1, 10, 4, 1);
        builder.push(3, 5, 2, 2, 4);
        expect([...builder.build().data]).toEqual([1, 2, 3, 0, 1, 0, 8, 4, 1, 0, 2, 5, 2, 2, 4]);
    });

    it("an out-of-order push drops the encoding; build sorts and re-encodes", () => {
        const builder = new SemanticTokensBuilder();
        builder.push(2, 4, 1, 0, 0);
        builder.push(2, 8, 1, 1, 0);
        builder.push(0, 3, 2, 2, 0); // earlier line
        builder.push(2, 1, 1, 0, 2); // earlier character on the same line
        expect([...builder.build().data]).toEqual([0, 3, 2, 2, 0, 2, 1, 1, 0, 2, 0, 3, 1, 0, 0, 0, 4, 1, 1, 0]);
    });

    it("switching to unordered mode on the same line also drops the encoding", () => {
        const builder = new SemanticTokensBuilder();
        builder.push(0, 5, 1, 0);
        builder.push(1, 5, 1, 0);
        builder.push(1, 2, 1, 1);
        expect([...builder.build().data]).toEqual([0, 5, 1, 0, 0, 1, 2, 1, 1, 0, 0, 3, 1, 0, 0]);
    });

    it("build(resultId) sets resultId and a Uint32Array", () => {
        const builder = new SemanticTokensBuilder();
        builder.push(0, 0, 1, 0);
        const tokens = builder.build("r1");
        expect(tokens).toBeInstanceOf(SemanticTokens);
        expect(tokens.resultId).toBe("r1");
        expect(tokens.data).toBeInstanceOf(Uint32Array);
        expect(new SemanticTokensBuilder().build().resultId).toBeUndefined();
    });

    it("unsuitable arguments throw Illegal argument", () => {
        const builder = new SemanticTokensBuilder(LEGEND);
        expect(() => {
            builder.push("0" as never, 0, 1, 0);
        }).toThrow("Illegal argument");
        expect(() => {
            builder.push(0, "0" as never, 1, 0);
        }).toThrow("Illegal argument");
        expect(() => {
            builder.push(0, 0, "1" as never, 0);
        }).toThrow("Illegal argument");
        expect(() => {
            builder.push(0, 0, 1, "x" as never);
        }).toThrow("Illegal argument");
        expect(() => {
            builder.push(new Range(0, 0, 0, 1), 0 as never);
        }).toThrow("Illegal argument");
        expect(() => {
            builder.push(0, 0, 1, 0, "x" as never);
        }).toThrow("Illegal argument");
        expect(() => {
            builder.push(new Range(0, 0, 0, 1), "class", ["declaration", 1] as never);
        }).toThrow("Illegal argument");
        expect(() => {
            builder.push({ start: { line: 0 }, end: { line: 0, character: 1 } } as never, "class");
        }).toThrow("Illegal argument");
        expect(() => {
            builder.push({ start: { line: 0, character: 0 }, end: { line: 0 } } as never, "class");
        }).toThrow("Illegal argument");
        expect(() => {
            builder.push(null as never, "class");
        }).toThrow("Illegal argument");
    });
});

describe("SemanticTokensBuilder — Range and names overload", () => {
    it("names map to legend indices, modifiers to bits", () => {
        const builder = new SemanticTokensBuilder(LEGEND);
        builder.push(new Range(0, 2, 0, 7), "variable", ["readonly", "static"]);
        builder.push(new Range(2, 0, 2, 4), "function");
        expect([...builder.build().data]).toEqual([0, 2, 5, 1, 6, 2, 0, 4, 2, 0]);
    });

    it("a duck-typed range (an object with positions) is accepted", () => {
        const builder = new SemanticTokensBuilder(LEGEND);
        builder.push({ start: { line: 1, character: 1 }, end: { line: 1, character: 3 } } as never, "class", [
            "declaration",
        ]);
        builder.push({ start: new Position(1, 5), end: new Position(1, 6) } as never, "class");
        expect([...builder.build().data]).toEqual([1, 1, 2, 0, 1, 0, 4, 1, 0, 0]);
    });

    it("errors: no legend, a multiline range, a type and a modifier outside the legend", () => {
        expect(() => {
            new SemanticTokensBuilder().push(new Range(0, 0, 0, 1), "class");
        }).toThrow("Legend must be provided in constructor");
        const builder = new SemanticTokensBuilder(LEGEND);
        expect(() => {
            builder.push(new Range(0, 0, 1, 1), "class");
        }).toThrow("`range` cannot span multiple lines");
        expect(() => {
            builder.push(new Range(0, 0, 0, 1), "nope");
        }).toThrow("`tokenType` is not in the provided legend");
        expect(() => {
            builder.push(new Range(0, 0, 0, 1), "class", ["nope"]);
        }).toThrow("`tokenModifier` is not in the provided legend");
        expect([...builder.build().data]).toEqual([]);
    });
});

describe("SemanticTokens / SemanticTokensEdit / SemanticTokensEdits", () => {
    it("store fields as passed", () => {
        const data = new Uint32Array([1, 2]);
        expect(new SemanticTokens(data)).toEqual({ resultId: undefined, data });
        const edit = new SemanticTokensEdit(5, 2, data);
        expect(edit).toEqual({ start: 5, deleteCount: 2, data });
        expect(new SemanticTokensEdit(0, 1).data).toBeUndefined();
        expect(new SemanticTokensEdits([edit], "r2")).toEqual({ resultId: "r2", edits: [edit] });
        expect(new SemanticTokensEdits([]).resultId).toBeUndefined();
    });
});
