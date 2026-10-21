import { describe, expect, it } from "vitest";

import { getSettingsCompletionContext, offsetToPosition, positionToOffset } from "./settingsContext.ts";

function at(marked: string) {
    const offset = marked.indexOf("|");
    if (offset === -1) throw new Error("The case has no `|` cursor marker");
    const text = marked.replace("|", "");
    return { context: getSettingsCompletionContext(text, offset), text };
}

function replaced(marked: string): string | null {
    const { context, text } = at(marked);
    if (context === null) return null;
    return text.slice(context.replaceRange.start, context.replaceRange.end);
}

describe("getSettingsCompletionContext — key position", () => {
    it("recognizes a key after the opening quote", () => {
        expect(at('{\n    "edi|\n}').context).toMatchObject({ kind: "key" });
    });

    it("covers the opening quote so the insertion does not double it", () => {
        expect(replaced('{\n    "edi|\n}')).toBe('"edi');
    });

    it("covers both quotes when the key is already closed", () => {
        expect(replaced('{\n    "edi|"\n}')).toBe('"edi"');
    });

    it("empty object → key, nothing to replace", () => {
        const { context } = at("{\n    |\n}");
        expect(context).toMatchObject({ kind: "key" });
        expect(replaced("{\n    |\n}")).toBe("");
    });

    it("bare word without quotes → key, the whole word is replaced", () => {
        expect(at("{\n    edi|\n}").context).toMatchObject({ kind: "key" });
        expect(replaced("{\n    edi|\n}")).toBe("edi");
    });

    it("second key after a comma", () => {
        expect(at('{\n    "a": 1,\n    "edi|\n}').context).toMatchObject({ kind: "key" });
        expect(replaced('{\n    "a": 1,\n    "edi|\n}')).toBe('"edi');
    });

    it("key in the middle of a line with a value already set", () => {
        expect(replaced('{\n    "a": 1, "b|": 2\n}')).toBe('"b"');
    });

    it("works with a leading comment (jsonc)", () => {
        expect(at('// comment\n{\n    "edi|\n}').context).toMatchObject({ kind: "key" });
    });

    it("cursor in the middle of the key, not at the end", () => {
        expect(replaced('{\n    "ed|itor"\n}')).toBe('"editor"');
    });
});

describe("getSettingsCompletionContext — value position", () => {
    it("empty value slot → knows the key", () => {
        expect(at('{\n    "editor.tabSize": |\n}').context).toMatchObject({
            kind: "value",
            key: "editor.tabSize",
        });
    });

    it("a started bare literal is replaced entirely", () => {
        const marked = '{\n    "editor.insertSpaces": t|\n}';
        expect(at(marked).context).toMatchObject({ kind: "value", key: "editor.insertSpaces" });
        expect(replaced(marked)).toBe("t");
    });

    it("a string value is replaced together with its quotes", () => {
        const marked = '{\n    "terminal.tier": "a|"\n}';
        expect(at(marked).context).toMatchObject({ kind: "value", key: "terminal.tier" });
        expect(replaced(marked)).toBe('"a"');
    });

    it("empty string value: both quotes are replaced", () => {
        expect(replaced('{\n    "terminal.tier": "|"\n}')).toBe('""');
    });

    it("a numeric value is replaced entirely", () => {
        expect(replaced('{\n    "editor.tabSize": 4|\n}')).toBe("4");
    });
});

describe("getSettingsCompletionContext — out of scope", () => {
    it("nested object → null (it has no schema)", () => {
        expect(at('{\n    "terminal.capabilities": { "osc|" }\n}').context).toBeNull();
    });

    it("empty document → null", () => {
        expect(getSettingsCompletionContext("", 0)).toBeNull();
    });

    it("value of an empty key → null (no schema for an empty key)", () => {
        expect(at('{\n    "": |\n}').context).toBeNull();
    });

    it("top-level array element → null (the key there is a numeric index)", () => {
        expect(at("[\n    |\n]").context).toBeNull();
    });
});

describe("positionToOffset / offsetToPosition", () => {
    const text = "{\n    abc\n}";

    it("converts a position to an offset", () => {
        expect(positionToOffset(text, 0, 0)).toBe(0);
        expect(positionToOffset(text, 1, 4)).toBe(6);
        expect(positionToOffset(text, 2, 1)).toBe(11);
    });

    it("converts an offset to a position", () => {
        expect(offsetToPosition(text, 0)).toEqual({ line: 0, character: 0 });
        expect(offsetToPosition(text, 6)).toEqual({ line: 1, character: 4 });
        expect(offsetToPosition(text, 11)).toEqual({ line: 2, character: 1 });
    });

    it("round-trip at every offset", () => {
        for (let offset = 0; offset <= text.length; offset++) {
            const pos = offsetToPosition(text, offset);
            expect(positionToOffset(text, pos.line, pos.character)).toBe(offset);
        }
    });

    it("clamps a position beyond the text", () => {
        expect(positionToOffset(text, 99, 0)).toBe(text.length);
        expect(positionToOffset(text, 1, 999)).toBe(text.length);
        expect(offsetToPosition(text, 999)).toEqual({ line: 2, character: 1 });
    });
});

describe("getSettingsCompletionContext — settings block of a workspace file", () => {
    function inSection(marked: string) {
        const offset = marked.indexOf("|");
        return getSettingsCompletionContext(marked.replace("|", ""), offset, "settings");
    }

    it("key and value inside settings", () => {
        expect(inSection('{ "settings": { "edi| } }')).toMatchObject({ kind: "key" });
        expect(inSection('{ "settings": { "editor.tabSize": | } }')).toMatchObject({
            kind: "value",
            key: "editor.tabSize",
        });
    });

    it("file root and other blocks are not our business", () => {
        expect(inSection('{ "fol| }')).toBeNull();
        expect(inSection('{ "folders": [{ "pa| }] }')).toBeNull();
        expect(inSection('{ "launch": { "con| } }')).toBeNull();
    });

    it("nested value object inside settings is not ours either", () => {
        expect(inSection('{ "settings": { "files.exclude": { "di| } } }')).toBeNull();
    });
});
