import vsctm from "vscode-textmate";
const { INITIAL } = vsctm;
import { describe, expect, it } from "vitest";

import { createTestRegistry } from "./testRegistry.ts";

/**
 * Учебные тесты на injection-грамматики: jsdoc отдаётся из `getInjections("source.js")`, а
 * `vscode-textmate` сам применяет её по `injectionSelector`.
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

        // injectionSelector у jsdoc.injection — `L:comment.block.documentation`,
        // line-comment имеет `comment.line` → injection не должен сработать
        for (const tok of result.tokens) {
            expect(tok.scopes).not.toContain("storage.type.class.jsdoc");
        }
    });
});
