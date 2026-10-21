import vsctm from "vscode-textmate";
const { INITIAL } = vsctm;
import { describe, expect, it } from "vitest";

import { createTestRegistry } from "./testRegistry.ts";

/** Learning tests: `ruleStack` flows through multiline constructs, `equals()` detects convergence. */
describe("vscode-textmate :: multiline state", () => {
    it("after opening `/*` the state is NOT equal to INITIAL", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const r1 = g.tokenizeLine("/* hello", INITIAL);

        expect(r1.ruleStack.equals(INITIAL)).toBe(false);
    });

    it("the second line inside `/* */` gets scope `comment.block.js`", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const r1 = g.tokenizeLine("/* hello", INITIAL);
        const r2 = g.tokenizeLine("still inside", r1.ruleStack);

        expect(r2.tokens[0].scopes).toContain("comment.block.js");
    });

    it("two consecutive lines inside a block comment give the same ruleStack (convergence)", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const r1 = g.tokenizeLine("/* line1", INITIAL);
        const r2 = g.tokenizeLine("line2", r1.ruleStack);
        const r3 = g.tokenizeLine("line3", r2.ruleStack);

        // r1 already ended in the "inside a comment" state;
        // subsequent lines keep the same state, which DocumentTokenStore
        // uses to stop background retokenization.
        expect(r1.ruleStack.equals(r2.ruleStack)).toBe(true);
        expect(r2.ruleStack.equals(r3.ruleStack)).toBe(true);
    });

    it("after closing `*/` the state again has no active comment frame", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const r1 = g.tokenizeLine("/* hello", INITIAL);
        const r2 = g.tokenizeLine("world */ const x = 1;", r1.ruleStack);

        // after `*/` in `r2` a regular JS token `const` appears
        const constTok = r2.tokens.find((t) => "world */ const x = 1;".slice(t.startIndex, t.endIndex) === "const");
        expect(constTok).toBeDefined();
        expect(constTok!.scopes).toContain("storage.type.js");
    });

    it("clone() returns a compatible copy of the state stack", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const r1 = g.tokenizeLine("/* hello", INITIAL);
        const cloned = r1.ruleStack.clone();

        expect(cloned.equals(r1.ruleStack)).toBe(true);
    });
});
