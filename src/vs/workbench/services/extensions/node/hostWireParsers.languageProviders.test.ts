import { describe, expect, it } from "vitest";

import { parseWireLanguageProviderRegistration, parseWireLanguageProviderUnregistration } from "./hostWireParsers.ts";

describe("hostWireParsers — parseWireLanguageProviderRegistration", () => {
    it("a valid registration passes as is", () => {
        const raw = {
            handle: 3,
            kind: "hover",
            selector: [
                { language: "typescript", scheme: "file", exclusive: true },
                { pattern: "**/*.json", notebookType: "jupyter" },
                { pattern: { base: "/w", pattern: "*.md" } },
            ],
        };
        expect(parseWireLanguageProviderRegistration(raw)).toStrictEqual(raw);
    });

    it("trigger characters: non-empty strings only; a non-array leaves no field", () => {
        const parsed = parseWireLanguageProviderRegistration({
            handle: 1,
            kind: "signatureHelp",
            selector: [],
            triggerCharacters: ["(", "", 7, ","],
            retriggerCharacters: ")",
        });
        expect(parsed).toEqual({ handle: 1, kind: "signatureHelp", selector: [], triggerCharacters: ["(", ","] });
        expect(
            parseWireLanguageProviderRegistration({
                handle: 1,
                kind: "signatureHelp",
                selector: [],
                retriggerCharacters: [")"],
            }),
        ).toEqual({ handle: 1, kind: "signatureHelp", selector: [], retriggerCharacters: [")"] });
    });

    it("code action kinds: non-empty strings only", () => {
        expect(
            parseWireLanguageProviderRegistration({
                handle: 2,
                kind: "codeActions",
                selector: [],
                providedCodeActionKinds: ["quickfix", "", 3, "source.organizeImports"],
            }),
        ).toStrictEqual({
            handle: 2,
            kind: "codeActions",
            selector: [],
            providedCodeActionKinds: ["quickfix", "source.organizeImports"],
        });
    });

    it("a foreign envelope shape gives null", () => {
        expect(parseWireLanguageProviderRegistration(null)).toBeNull();
        expect(parseWireLanguageProviderRegistration(undefined)).toBeNull();
        expect(parseWireLanguageProviderRegistration("hover")).toBeNull();
        expect(parseWireLanguageProviderRegistration({ handle: "1", kind: "hover", selector: [] })).toBeNull();
        expect(parseWireLanguageProviderRegistration({ handle: 1.5, kind: "hover", selector: [] })).toBeNull();
        expect(parseWireLanguageProviderRegistration({ handle: 1, kind: "teleport", selector: [] })).toBeNull();
        expect(parseWireLanguageProviderRegistration({ handle: 1, kind: "hover", selector: "ts" })).toBeNull();
    });

    it("filters: non-objects are dropped, so are fields of a foreign type, the rest stays", () => {
        const parsed = parseWireLanguageProviderRegistration({
            handle: 0,
            kind: "hover",
            selector: [
                null,
                "typescript",
                { language: 1, scheme: "file", notebookType: false, exclusive: "yes" },
                { pattern: { base: "/w" } },
                { pattern: { base: 1, pattern: "*.md" } },
                { pattern: 7 },
                { pattern: null },
            ],
        });
        expect(parsed?.selector).toStrictEqual([{ scheme: "file" }, {}, {}, {}, {}]);
    });
});

describe("hostWireParsers — parseWireLanguageProviderUnregistration", () => {
    it("takes an integer handle, anything else gives null", () => {
        expect(parseWireLanguageProviderUnregistration({ handle: 0 })).toStrictEqual({ handle: 0 });
        expect(parseWireLanguageProviderUnregistration({ handle: "0" })).toBeNull();
        expect(parseWireLanguageProviderUnregistration({})).toBeNull();
        expect(parseWireLanguageProviderUnregistration(null)).toBeNull();
        expect(parseWireLanguageProviderUnregistration(5)).toBeNull();
        expect(parseWireLanguageProviderUnregistration(undefined)).toBeNull();
    });
});

describe("hostWireParsers — semantic tokens registration", () => {
    it("legend: positional non-strings become empty strings, a non-array becomes an empty list", () => {
        expect(
            parseWireLanguageProviderRegistration({
                handle: 4,
                kind: "semanticTokens",
                selector: [],
                legend: { tokenTypes: ["class", 7, "variable"], tokenModifiers: "declaration" },
                hasOnDidChange: true,
            }),
        ).toStrictEqual({
            handle: 4,
            kind: "semanticTokens",
            selector: [],
            legend: { tokenTypes: ["class", "", "variable"], tokenModifiers: [] },
            hasOnDidChange: true,
        });
    });

    it("extensionId passes only as a string", () => {
        const registration = { handle: 6, kind: "formatting", selector: [] };
        expect(parseWireLanguageProviderRegistration({ ...registration, extensionId: "acme.fmt" })).toStrictEqual({
            ...registration,
            extensionId: "acme.fmt",
        });
        expect(parseWireLanguageProviderRegistration({ ...registration, extensionId: 7 })).toStrictEqual(registration);
    });

    it("a non-object legend leaves no field; hasOnDidChange only on true", () => {
        for (const legend of [null, "x", 3, undefined]) {
            expect(
                parseWireLanguageProviderRegistration({
                    handle: 5,
                    kind: "rangeSemanticTokens",
                    selector: [],
                    legend,
                    hasOnDidChange: "yes",
                }),
            ).toStrictEqual({ handle: 5, kind: "rangeSemanticTokens", selector: [] });
        }
    });
});
