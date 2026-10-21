import { describe, expect, it } from "vitest";

import { createTestRegistry } from "./testRegistry.ts";

/** Учебные тесты: как `vscode-textmate.Registry` находит и загружает грамматики. */
describe("vscode-textmate :: Registry", () => {
    it("loadGrammar возвращает IGrammar для известного scopeName", async () => {
        const registry = createTestRegistry();
        const grammar = await registry.loadGrammar("source.js");
        expect(grammar).not.toBeNull();
        expect(typeof grammar?.tokenizeLine).toBe("function");
    });

    it("loadGrammar бросает 'No grammar provided' если loadGrammar(scopeName) вернул null", async () => {
        const registry = createTestRegistry();
        await expect(registry.loadGrammar("source.fortran")).rejects.toThrowError(/No grammar provided/);
    });

    it("один и тот же scope возвращает идентичный объект (кеш Registry)", async () => {
        const registry = createTestRegistry();
        const a = await registry.loadGrammar("source.js");
        const b = await registry.loadGrammar("source.js");
        expect(a).toBe(b);
    });
});
