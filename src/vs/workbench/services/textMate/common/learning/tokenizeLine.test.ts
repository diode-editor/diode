import vsctm from "vscode-textmate";
const { INITIAL } = vsctm;
import { describe, expect, it } from "vitest";

import { createTestRegistry } from "./testRegistry.ts";

/** Learning tests: the shape of the `IGrammar.tokenizeLine` result and the basic scope stack. */
describe("vscode-textmate :: tokenizeLine", () => {
    it("returns a token array, ruleStack and the stoppedEarly flag", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const result = g.tokenizeLine("const x = 1;", INITIAL);

        expect(Array.isArray(result.tokens)).toBe(true);
        expect(result.ruleStack).toBeDefined();
        expect(result.stoppedEarly).toBe(false);
    });

    it("each token has startIndex, endIndex and a scopes stack (from general to specific)", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const result = g.tokenizeLine("const x = 1;", INITIAL);
        const first = result.tokens[0];

        expect(first.startIndex).toBe(0);
        expect(typeof first.endIndex).toBe("number");
        expect(first.scopes[0]).toBe("source.js");
    });

    it("recognizes `const` as keyword `storage.type.js`", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const line = "const x = 1;";
        const result = g.tokenizeLine(line, INITIAL);
        const constTok = result.tokens.find((t) => line.slice(t.startIndex, t.endIndex) === "const");

        expect(constTok).toBeDefined();
        expect(constTok!.scopes).toContain("storage.type.js");
    });

    it("a numeric literal gets scope `constant.numeric.decimal.js`", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const line = "const x = 1;";
        const result = g.tokenizeLine(line, INITIAL);
        const numberTok = result.tokens.find((t) => line.slice(t.startIndex, t.endIndex) === "1");

        expect(numberTok).toBeDefined();
        expect(numberTok!.scopes).toContain("constant.numeric.decimal.js");
    });

    it("the `;` terminator gets scope `punctuation.terminator.statement.js`", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const line = "const x = 1;";
        const result = g.tokenizeLine(line, INITIAL);
        const semi = result.tokens[result.tokens.length - 1];

        expect(line.slice(semi.startIndex, semi.endIndex)).toBe(";");
        expect(semi.scopes).toContain("punctuation.terminator.statement.js");
    });

    it("tokens cover the whole line without gaps", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const line = "const x = 1;";
        const tokens = g.tokenizeLine(line, INITIAL).tokens;

        expect(tokens[0].startIndex).toBe(0);
        for (let i = 1; i < tokens.length; i++) {
            expect(tokens[i].startIndex).toBe(tokens[i - 1].endIndex);
        }
        expect(tokens[tokens.length - 1].endIndex).toBe(line.length);
    });
});
