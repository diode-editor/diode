import { describe, expect, it } from "vitest";

import { SnippetString } from "./vscodeTypes.ts";

/** Upstream's `extHostTypes/snippetString.ts` (#1030): the same template text for the same builder calls. */
describe("SnippetString", () => {
    it("[api:SnippetString] starts empty, and the constructor keeps the template as given", () => {
        expect(new SnippetString().value).toBe("");
        expect(new SnippetString("${1:a}").value).toBe("${1:a}");
    });

    it("[api:SnippetString.appendText] every builder returns the snippet itself", () => {
        const snippet = new SnippetString();

        expect(snippet.appendText("a")).toBe(snippet);
        expect(snippet.appendTabstop()).toBe(snippet);
        expect(snippet.appendPlaceholder("b")).toBe(snippet);
        expect(snippet.appendChoice(["c"])).toBe(snippet);
        expect(snippet.appendVariable("d")).toBe(snippet);
    });

    it("[api:SnippetString.appendTabstop] [api:SnippetString.appendPlaceholder] builds upstream's example", () => {
        const snippet = new SnippetString()
            .appendText("This is a ")
            .appendTabstop()
            .appendPlaceholder("placeholder")
            .appendText(" snippet");

        expect(snippet.value).toBe("This is a $1${2:placeholder} snippet");
    });

    it("[api:SnippetString.appendText] escapes dollar, closing curly and backslash", () => {
        expect(new SnippetString().appendText("a $1 } \\ b { c").value).toBe("a \\$1 \\} \\\\ b { c");
    });

    it("[api:SnippetString.appendText] keeps what the constructor was given unescaped", () => {
        expect(new SnippetString("$1").appendText("$").value).toBe("$1\\$");
    });

    it("[api:SnippetString.appendTabstop] an explicit number does not move the counter", () => {
        expect(new SnippetString().appendTabstop(5).appendTabstop().appendTabstop().value).toBe("$5$1$2");
    });

    it("[api:SnippetString.appendPlaceholder] numbers by the shared counter unless given a number, and escapes text", () => {
        const snippet = new SnippetString().appendPlaceholder("x").appendPlaceholder("y", 7).appendPlaceholder("z");

        expect(snippet.value).toBe("${1:x}${7:y}${2:z}");
        expect(new SnippetString().appendPlaceholder("$}\\").value).toBe("${1:\\$\\}\\\\}");
    });

    it("[api:SnippetString.appendPlaceholder] a nested builder continues the counter and hands it back", () => {
        const snippet = new SnippetString()
            .appendPlaceholder((nested) => nested.appendText("a$").appendTabstop())
            .appendTabstop();

        expect(snippet.value).toBe("${1:a\\$$2}$3");
    });

    it("[api:SnippetString.appendPlaceholder] a nested builder's return value is ignored", () => {
        expect(new SnippetString().appendPlaceholder(() => "ignored").value).toBe("${1:}");
    });

    it("[api:SnippetString.appendChoice] escapes pipe, comma and backslash in each value", () => {
        const snippet = new SnippetString().appendChoice(["a", "b|c", "d,e", "f\\g", "$}"]);

        expect(snippet.value).toBe("${1|a,b\\|c,d\\,e,f\\\\g,$}|}");
    });

    it("[api:SnippetString.appendChoice] shares the counter with tabstops and takes an explicit number", () => {
        const snippet = new SnippetString().appendChoice(["a"], 4).appendChoice(["b", "c"]).appendTabstop();

        expect(snippet.value).toBe("${4|a|}${1|b,c|}$2");
    });

    it("[api:SnippetString.appendVariable] a default goes after a colon, an empty or missing one does not", () => {
        expect(new SnippetString().appendVariable("TM_FILENAME", "x").value).toBe("${TM_FILENAME:x}");
        expect(new SnippetString().appendVariable("TM_FILENAME", "").value).toBe("${TM_FILENAME}");
        expect(new SnippetString().appendVariable("TM_FILENAME").value).toBe("${TM_FILENAME}");
    });

    it("[api:SnippetString.appendVariable] a string default escapes dollar and closing curly but not backslash", () => {
        expect(new SnippetString().appendVariable("TM_FILENAME", "$}\\").value).toBe("${TM_FILENAME:\\$\\}\\}");
    });

    it("[api:SnippetString.appendVariable] a nested default shares the counter", () => {
        const snippet = new SnippetString()
            .appendTabstop()
            .appendVariable("TM_FILENAME", (nested) => nested.appendPlaceholder("$name"))
            .appendTabstop();

        expect(snippet.value).toBe("$1${TM_FILENAME:${2:\\$name}}$3");
    });

    it("[api:SnippetString] isSnippetString: an instance or any object with a string value", () => {
        expect(SnippetString.isSnippetString(new SnippetString())).toBe(true);
        expect(SnippetString.isSnippetString({ value: "x" })).toBe(true);
        expect(SnippetString.isSnippetString({ value: 1 })).toBe(false);
        expect(SnippetString.isSnippetString({})).toBe(false);
        expect(SnippetString.isSnippetString("x")).toBe(false);
        expect(SnippetString.isSnippetString(null)).toBe(false);
        expect(SnippetString.isSnippetString(undefined)).toBe(false);
    });
});
