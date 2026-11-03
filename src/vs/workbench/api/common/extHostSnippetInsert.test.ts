import { describe, expect, it } from "vitest";

import { snippetText } from "./extHostSnippetInsert.ts";

describe("snippetText", () => {
    it("keeps the text of placeholders and the first choice, drops tab stops", () => {
        expect(snippetText("a $1 ${2} ${3:name} ${4|one,two|} $0b")).toBe("a   name one b");
    });

    it("TM_SELECTED_TEXT is empty in both forms, other variables stay text", () => {
        expect(snippetText("[$TM_SELECTED_TEXT|${TM_SELECTED_TEXT}|$TM_SELECTED_TEXTS|$TM_FILENAME]")).toBe(
            "[||$TM_SELECTED_TEXTS|$TM_FILENAME]",
        );
    });

    it("unescapes what upstream escapes and keeps any other backslash", () => {
        expect(snippetText("\\$x \\} \\\\ \\n \\$5")).toBe("$x } \\ \\n $5");
        expect(snippetText("${1:a\\}b} a}b")).toBe("a}b a}b");
    });

    it("takes the first choice up to an unescaped comma, and unescapes it", () => {
        expect(snippetText("${1|a\\,b,c|}")).toBe("a,b");
        expect(snippetText("${1|a\\|b\\\\,c|}")).toBe("a|b\\");
    });

    it("nested placeholders leave their text; a mirror takes the text of its placeholder", () => {
        expect(snippetText("${1:a\\$b ${2:${3:deep}}!}")).toBe("a$b deep!");
        expect(snippetText("$1 ${1:x} ${1}")).toBe("x x x");
        // The first placeholder with text gives the mirror its text, not a later one.
        expect(snippetText("${1:x} ${1:y} $1").endsWith(" x")).toBe(true);
        expect(snippetText("${2:${1:in}} $1")).toBe("in in");
    });

    it("survives a mirror inside its own placeholder", () => {
        expect(snippetText("${1:a$1b}")).toBe("ab");
        expect(snippetText("${1:a$2} ${2:b$1}")).toBe("ab ba");
    });

    it("a placeholder without its closing brace is text", () => {
        expect(snippetText("${1:abc")).toBe("${1:abc");
        expect(snippetText("${1:ab$2")).toBe("${1:ab");
        expect(snippetText("$ ${x}")).toBe("$ ${x}");
        expect(snippetText("${1|a,b")).toBe("${1|a,b");
    });

    it("keeps the whitespace and line breaks of the template", () => {
        expect(snippetText("\n\t$0x\r\n")).toBe("\n\tx\r\n");
    });
});
