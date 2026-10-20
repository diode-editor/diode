import { describe, expect, it } from "vitest";

import { NULL_SEMANTIC_TOKEN_STYLE_RESOLVER } from "./iSemanticTokenStyleResolver.ts";

describe("NULL_SEMANTIC_TOKEN_STYLE_RESOLVER", () => {
    it("ничего не стилизует, семантическая подсветка выключена", () => {
        expect(NULL_SEMANTIC_TOKEN_STYLE_RESOLVER.resolve("variable", ["readonly"], "typescript")).toBeNull();
        expect(NULL_SEMANTIC_TOKEN_STYLE_RESOLVER.semanticHighlighting).toBe(false);
    });
});
