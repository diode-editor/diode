import vsctm from "vscode-textmate";
const { INITIAL } = vsctm;
import { describe, expect, it } from "vitest";

import { createTestRegistry } from "./testRegistry.ts";

/** Учебные тесты: `ruleStack` течёт через многострочные конструкции, `equals()` ловит сходимость. */
describe("vscode-textmate :: multiline state", () => {
    it("после открытия `/*` состояние НЕ равно INITIAL", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const r1 = g.tokenizeLine("/* hello", INITIAL);

        expect(r1.ruleStack.equals(INITIAL)).toBe(false);
    });

    it("вторая строка внутри `/* */` получает scope `comment.block.js`", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const r1 = g.tokenizeLine("/* hello", INITIAL);
        const r2 = g.tokenizeLine("still inside", r1.ruleStack);

        expect(r2.tokens[0].scopes).toContain("comment.block.js");
    });

    it("две подряд идущие строки внутри блока комментария дают одинаковый ruleStack (convergence)", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const r1 = g.tokenizeLine("/* line1", INITIAL);
        const r2 = g.tokenizeLine("line2", r1.ruleStack);
        const r3 = g.tokenizeLine("line3", r2.ruleStack);

        // r1 уже завершилось состоянием «внутри комментария»;
        // последующие строки сохраняют то же состояние — DocumentTokenStore
        // использует это чтобы прервать background re-tokenization.
        expect(r1.ruleStack.equals(r2.ruleStack)).toBe(true);
        expect(r2.ruleStack.equals(r3.ruleStack)).toBe(true);
    });

    it("после закрытия `*/` состояние снова без активной комментарий-фрейма", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const r1 = g.tokenizeLine("/* hello", INITIAL);
        const r2 = g.tokenizeLine("world */ const x = 1;", r1.ruleStack);

        // в `r2` после `*/` появляется обычный JS-токен `const`
        const constTok = r2.tokens.find((t) => "world */ const x = 1;".slice(t.startIndex, t.endIndex) === "const");
        expect(constTok).toBeDefined();
        expect(constTok!.scopes).toContain("storage.type.js");
    });

    it("clone() возвращает совместимую копию state-стека", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const r1 = g.tokenizeLine("/* hello", INITIAL);
        const cloned = r1.ruleStack.clone();

        expect(cloned.equals(r1.ruleStack)).toBe(true);
    });
});
