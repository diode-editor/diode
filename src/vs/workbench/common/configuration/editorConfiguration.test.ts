import { describe, expect, it } from "vitest";

import { editorConfiguration } from "./editorConfiguration.ts";

// onSave defaults must be off (#196): with them a save leaves the file byte-for-byte unchanged.

describe("editorConfiguration — emptySelectionClipboard", () => {
    it("boolean, enabled by default, as in VS Code", () => {
        const schema = editorConfiguration.properties["editor.emptySelectionClipboard"];
        expect(schema.type).toBe("boolean");
        expect(schema.default).toBe(true);
        expect(schema.description).toContain("copies the current line");
    });
});

describe("editorConfiguration: inline suggestions", () => {
    it("editor.inlineSuggest.enabled: boolean, enabled by default (gates only the automatic request)", () => {
        const schema = editorConfiguration.properties["editor.inlineSuggest.enabled"];
        expect(schema.type).toBe("boolean");
        expect(schema.default).toBe(true);
        expect(schema.description).toContain("automatically show inline suggestions");
    });

    it("editor.inlineSuggest.delay: number, 50 ms by default", () => {
        const schema = editorConfiguration.properties["editor.inlineSuggest.delay"];
        expect(schema.type).toBe("number");
        expect(schema.default).toBe(50);
        // Both halves of the concatenated description: settings.json completion shows them.
        expect(schema.description).toContain("before automatically requesting an inline suggestion");
        expect(schema.description).toContain("slow or metered provider");
    });

    it("editor.inlineSuggest.requestTimeout: number, 5000 ms by default", () => {
        const schema = editorConfiguration.properties["editor.inlineSuggest.requestTimeout"];
        expect(schema.type).toBe("number");
        expect(schema.default).toBe(5000);
        expect(schema.description).toContain("wait for an inline suggestion provider to answer");
        expect(schema.description).toContain("no suggestion is shown");
    });
});

describe("editorConfiguration: suggest auto-open (upstream defaults)", () => {
    it("quickSuggestions: yields to inline suggestions in code, off in comments and strings", () => {
        const schema = editorConfiguration.properties["editor.quickSuggestions"];
        expect(schema.type).toEqual(["boolean", "string", "object"]);
        expect(schema.default).toEqual({ other: "offWhenInlineCompletions", comments: "off", strings: "off" });
    });

    it("quickSuggestionsDelay 10 ms, suggestOnTriggerCharacters on, suppressSuggestions off", () => {
        expect(editorConfiguration.properties["editor.quickSuggestionsDelay"].default).toBe(10);
        expect(editorConfiguration.properties["editor.suggestOnTriggerCharacters"].default).toBe(true);
        expect(editorConfiguration.properties["editor.inlineSuggest.suppressSuggestions"].default).toBe(false);
    });

    it("wordBasedSuggestions: five upstream modes, default offWithInlineSuggestions", () => {
        const schema = editorConfiguration.properties["editor.wordBasedSuggestions"];
        expect(schema.enum).toEqual([
            "off",
            "offWithInlineSuggestions",
            "currentDocument",
            "matchingDocuments",
            "allDocuments",
        ]);
        expect(schema.enumDescriptions).toHaveLength(5);
        expect(schema.default).toBe("offWithInlineSuggestions");
    });
});

describe("editorConfiguration: onSave settings", () => {
    it("editor.formatOnSave: boolean, disabled by default", () => {
        const schema = editorConfiguration.properties["editor.formatOnSave"];
        expect(schema.type).toBe("boolean");
        expect(schema.default).toBe(false);
        expect(schema.description).toContain("Format a file on save");
    });

    it("editor.codeActionsOnSave: object or array, empty by default, description mentions the kind hierarchy", () => {
        const schema = editorConfiguration.properties["editor.codeActionsOnSave"];
        expect(schema.type).toEqual(["object", "array"]);
        expect(schema.default).toEqual({});
        // One phrase from each half of the concatenation.
        expect(schema.description).toContain("run on save");
        expect(schema.description).toContain("hierarchically");
    });
});
