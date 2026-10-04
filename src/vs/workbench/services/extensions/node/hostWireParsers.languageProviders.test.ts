import { describe, expect, it } from "vitest";

import { parseWireLanguageProviderRegistration, parseWireLanguageProviderUnregistration } from "./hostWireParsers.ts";

describe("hostWireParsers — parseWireLanguageProviderRegistration", () => {
    it("валидная регистрация проходит как есть", () => {
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

    it("триггер-символы: только непустые строки; не-массив — поля нет", () => {
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

    it("виды code actions: только непустые строки", () => {
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

    it("чужая форма конверта — null", () => {
        expect(parseWireLanguageProviderRegistration(null)).toBeNull();
        expect(parseWireLanguageProviderRegistration(undefined)).toBeNull();
        expect(parseWireLanguageProviderRegistration("hover")).toBeNull();
        expect(parseWireLanguageProviderRegistration({ handle: "1", kind: "hover", selector: [] })).toBeNull();
        expect(parseWireLanguageProviderRegistration({ handle: 1.5, kind: "hover", selector: [] })).toBeNull();
        expect(parseWireLanguageProviderRegistration({ handle: 1, kind: "teleport", selector: [] })).toBeNull();
        expect(parseWireLanguageProviderRegistration({ handle: 1, kind: "hover", selector: "ts" })).toBeNull();
    });

    it("фильтры: не-объекты отбрасываются, поля чужого типа — тоже, остальное остаётся", () => {
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
    it("берёт целый handle, остальное — null", () => {
        expect(parseWireLanguageProviderUnregistration({ handle: 0 })).toStrictEqual({ handle: 0 });
        expect(parseWireLanguageProviderUnregistration({ handle: "0" })).toBeNull();
        expect(parseWireLanguageProviderUnregistration({})).toBeNull();
        expect(parseWireLanguageProviderUnregistration(null)).toBeNull();
        expect(parseWireLanguageProviderUnregistration(5)).toBeNull();
        expect(parseWireLanguageProviderUnregistration(undefined)).toBeNull();
    });
});
