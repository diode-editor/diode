import { describe, expect, it } from "vitest";

import { createLineTokens, createToken } from "./iLineTokens.ts";
import { standardTokenTypeAt } from "./standardTokenType.ts";

describe("standardTokenTypeAt — вид токена по скоупам TextMate", () => {
    const tokens = createLineTokens([
        createToken(0, ["source.ts"]),
        createToken(4, ["source.ts", "string.quoted.double.ts"]),
        createToken(10, ["source.ts", "comment.line.double-slash.ts"]),
        createToken(20, ["source.ts", "string.template.ts", "meta.embedded.line.ts"]),
        createToken(25, ["source.ts", "string.regexp.ts"]),
    ]);

    it("строка, комментарий, прочее — по накрывающему токену", () => {
        expect(standardTokenTypeAt(tokens, 0)).toBe("other");
        expect(standardTokenTypeAt(tokens, 3)).toBe("other");
        expect(standardTokenTypeAt(tokens, 4)).toBe("string");
        expect(standardTokenTypeAt(tokens, 9)).toBe("string");
        expect(standardTokenTypeAt(tokens, 10)).toBe("comment");
    });

    it("побеждает самый вложенный скоуп: meta.embedded внутри строки — код", () => {
        expect(standardTokenTypeAt(tokens, 21)).toBe("other");
    });

    it("регекс: `string.regexp` — строка, голый `regex` — «прочее»", () => {
        // Как у vscode-textmate: `\bregex\b` слово `regexp` не ловит, зато ловит
        // `string` той же строки скоупа; вид RegEx для настройки — «прочее».
        expect(standardTokenTypeAt(tokens, 26)).toBe("string");
        const regex = createLineTokens([createToken(0, ["source.js", "regex.js"])]);
        expect(standardTokenTypeAt(regex, 0)).toBe("other");
    });

    it("без токенов — прочее", () => {
        expect(standardTokenTypeAt(undefined, 3)).toBe("other");
        expect(standardTokenTypeAt(createLineTokens([createToken(5, ["comment"])]), 2)).toBe("other");
    });
});
