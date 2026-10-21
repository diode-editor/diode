import { describe, expect, it } from "vitest";

import { NULL_SEMANTIC_TOKEN_STYLE_RESOLVER } from "./iSemanticTokenStyleResolver.ts";

describe("NULL_SEMANTIC_TOKEN_STYLE_RESOLVER", () => {
    it("styles nothing, semantic highlighting is off", () => {
        expect(NULL_SEMANTIC_TOKEN_STYLE_RESOLVER.resolve("variable", ["readonly"], "typescript")).toBeNull();
        expect(NULL_SEMANTIC_TOKEN_STYLE_RESOLVER.semanticHighlighting).toBe(false);
    });
});
