import { describe, expect, it } from "vitest";

import type { ILanguageConfiguration } from "../../../platform/extensions/common/iLanguageConfiguration.ts";

import {
    DEFAULT_AUTO_CLOSE_BEFORE,
    EMPTY_LANGUAGE_CONFIGURATION,
    resolveLanguageConfiguration,
} from "./languageConfiguration.ts";

describe("resolveLanguageConfiguration", () => {
    it("resolves a full configuration with explicit sections", () => {
        const resolved = resolveLanguageConfiguration({
            comments: { lineComment: "//", blockComment: ["/*", "*/"] },
            brackets: [
                ["{", "}"],
                ["[", "]"],
            ],
            autoClosingPairs: [["{", "}"], { open: "'", close: "'", notIn: ["string", "comment"] }],
            surroundingPairs: [["(", ")"], { open: '"', close: '"' }],
            autoCloseBefore: ";)",
        });

        expect(resolved.comments).toEqual({ lineComment: "//", blockComment: ["/*", "*/"] });
        expect(resolved.brackets).toEqual([
            ["{", "}"],
            ["[", "]"],
        ]);
        expect(resolved.autoClosingPairs).toEqual([
            { open: "{", close: "}", notIn: [] },
            { open: "'", close: "'", notIn: ["string", "comment"] },
        ]);
        expect(resolved.surroundingPairs).toEqual([
            ["(", ")"],
            ['"', '"'],
        ]);
        expect(resolved.autoCloseBefore).toBe(";)");
    });

    it("derives autoClosingPairs from brackets when the section is absent", () => {
        const resolved = resolveLanguageConfiguration({
            brackets: [
                ["{", "}"],
                ["(", ")"],
            ],
        });
        expect(resolved.autoClosingPairs).toEqual([
            { open: "{", close: "}", notIn: [] },
            { open: "(", close: ")", notIn: [] },
        ]);
    });

    it("derives surroundingPairs from autoClosingPairs when the section is absent", () => {
        const resolved = resolveLanguageConfiguration({
            autoClosingPairs: [{ open: "<", close: ">" }],
        });
        expect(resolved.surroundingPairs).toEqual([["<", ">"]]);
    });

    it("derives surroundingPairs from brackets when both pair sections are absent", () => {
        const resolved = resolveLanguageConfiguration({ brackets: [["[", "]"]] });
        expect(resolved.surroundingPairs).toEqual([["[", "]"]]);
    });

    it("keeps an explicitly empty autoClosingPairs section (no fallback to brackets)", () => {
        const resolved = resolveLanguageConfiguration({ brackets: [["{", "}"]], autoClosingPairs: [] });
        expect(resolved.autoClosingPairs).toEqual([]);
        expect(resolved.surroundingPairs).toEqual([]);
    });

    it("uses the VS Code default for autoCloseBefore when unset", () => {
        expect(resolveLanguageConfiguration({}).autoCloseBefore).toBe(DEFAULT_AUTO_CLOSE_BEFORE);
    });

    it("drops comment tokens that are empty and the section when nothing is left", () => {
        expect(resolveLanguageConfiguration({ comments: {} }).comments).toBeUndefined();
        expect(resolveLanguageConfiguration({ comments: { lineComment: "" } }).comments).toBeUndefined();
        expect(resolveLanguageConfiguration({ comments: { lineComment: "#" } }).comments).toEqual({
            lineComment: "#",
            blockComment: undefined,
        });
        expect(resolveLanguageConfiguration({ comments: { blockComment: ["<!--", "-->"] } }).comments).toEqual({
            lineComment: undefined,
            blockComment: ["<!--", "-->"],
        });
    });

    it("drops malformed pairs instead of failing the whole configuration", () => {
        // Реальные файлы парсятся из JSONC без валидации схемы — формы могут быть любыми.
        const raw = {
            comments: { blockComment: ["/*", ""] },
            brackets: [["{", "}"], ["", "]"], ["("], "junk", 42, null],
            autoClosingPairs: [
                { open: "{", close: "}" },
                { open: "", close: ")" },
                { open: "(", close: "" },
                // Не-строковый open при валидном close: length-проверки такую
                // запись пропустили бы, отсекает её именно проверка типа.
                { open: 5, close: ")" },
                { open: "(", close: 5 },
                { open: "'" },
                42,
                null,
                "junk",
            ],
            surroundingPairs: [["<", ">"], ["a", ""], [5, "]"], ["[", 5], { open: '"' }, null, 42],
        } as unknown as ILanguageConfiguration;

        const resolved = resolveLanguageConfiguration(raw);
        expect(resolved.comments).toBeUndefined();
        expect(resolved.brackets).toEqual([["{", "}"]]);
        expect(resolved.autoClosingPairs).toEqual([{ open: "{", close: "}", notIn: [] }]);
        expect(resolved.surroundingPairs).toEqual([["<", ">"]]);
    });

    it("секция не-массив (или null) — считается пустой", () => {
        const raw = {
            brackets: "junk",
            autoClosingPairs: 42,
            surroundingPairs: null,
        } as unknown as ILanguageConfiguration;

        const resolved = resolveLanguageConfiguration(raw);
        expect(resolved.brackets).toEqual([]);
        expect(resolved.autoClosingPairs).toEqual([]);
        expect(resolved.surroundingPairs).toEqual([]);
    });

    it("comments: null не роняет разбор", () => {
        const raw = { comments: null } as unknown as ILanguageConfiguration;
        expect(resolveLanguageConfiguration(raw).comments).toBeUndefined();
    });

    it("EMPTY_LANGUAGE_CONFIGURATION carries no rules but the default autoCloseBefore", () => {
        expect(EMPTY_LANGUAGE_CONFIGURATION.comments).toBeUndefined();
        expect(EMPTY_LANGUAGE_CONFIGURATION.brackets).toEqual([]);
        expect(EMPTY_LANGUAGE_CONFIGURATION.autoClosingPairs).toEqual([]);
        expect(EMPTY_LANGUAGE_CONFIGURATION.surroundingPairs).toEqual([]);
        expect(EMPTY_LANGUAGE_CONFIGURATION.autoCloseBefore).toBe(DEFAULT_AUTO_CLOSE_BEFORE);
    });
});
