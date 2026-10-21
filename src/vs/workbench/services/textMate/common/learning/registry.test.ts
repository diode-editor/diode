import { describe, expect, it } from "vitest";

import { createTestRegistry } from "./testRegistry.ts";

/** Learning tests: how `vscode-textmate.Registry` finds and loads grammars. */
describe("vscode-textmate :: Registry", () => {
    it("loadGrammar returns an IGrammar for a known scopeName", async () => {
        const registry = createTestRegistry();
        const grammar = await registry.loadGrammar("source.js");
        expect(grammar).not.toBeNull();
        expect(typeof grammar?.tokenizeLine).toBe("function");
    });

    it("loadGrammar throws 'No grammar provided' if loadGrammar(scopeName) returned null", async () => {
        const registry = createTestRegistry();
        await expect(registry.loadGrammar("source.fortran")).rejects.toThrowError(/No grammar provided/);
    });

    it("the same scope returns an identical object (Registry cache)", async () => {
        const registry = createTestRegistry();
        const a = await registry.loadGrammar("source.js");
        const b = await registry.loadGrammar("source.js");
        expect(a).toBe(b);
    });
});
