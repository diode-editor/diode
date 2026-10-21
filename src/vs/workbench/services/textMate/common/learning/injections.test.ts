import vsctm from "vscode-textmate";
const { INITIAL } = vsctm;
import { describe, expect, it } from "vitest";

import { createTestRegistry } from "./testRegistry.ts";

/**
 * Learning tests for injection grammars: jsdoc is returned from `getInjections("source.js")`, and
 * `vscode-textmate` applies it by `injectionSelector` itself.
 */
describe("vscode-textmate :: injections (jsdoc)", () => {
    it("`@param` внутри `/** ... */` получает scope `storage.type.class.jsdoc`", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const line = "/** @param {string} x */";
        const result = g.tokenizeLine(line, INITIAL);
        const paramTok = result.tokens.find((t) => line.slice(t.startIndex, t.endIndex) === "param");

        expect(paramTok).toBeDefined();
        expect(paramTok!.scopes).toContain("comment.block.documentation.js");
        expect(paramTok!.scopes).toContain("storage.type.class.jsdoc");
    });

    it("тип внутри `{string}` получает scope `entity.name.type.instance.jsdoc`", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const line = "/** @param {string} x */";
        const result = g.tokenizeLine(line, INITIAL);
        const stringTok = result.tokens.find((t) => line.slice(t.startIndex, t.endIndex) === "string");

        expect(stringTok).toBeDefined();
        expect(stringTok!.scopes).toContain("entity.name.type.instance.jsdoc");
    });

    it("обычный `// line comment` НЕ активирует jsdoc-injection", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const line = "// @param x";
        const result = g.tokenizeLine(line, INITIAL);

        // jsdoc.injection's injectionSelector is `L:comment.block.documentation`;
        // a line comment has `comment.line`, so the injection must not apply
        for (const tok of result.tokens) {
            expect(tok.scopes).not.toContain("storage.type.class.jsdoc");
        }
    });
});
