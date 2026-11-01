import { describe, expect, it } from "vitest";

import type {
    ILanguageConfiguration,
    IOnEnterAction,
} from "../../../platform/extensions/common/iLanguageConfiguration.ts";

import {
    DEFAULT_AUTO_CLOSE_BEFORE,
    EMPTY_LANGUAGE_CONFIGURATION,
    resolveLanguageConfiguration,
} from "./languageConfiguration.ts";

const ENTER_NONE: IOnEnterAction = { indent: "none" };
const ENTER_INDENT: IOnEnterAction = { indent: "indent" };

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
        const raw = {
            comments: { blockComment: ["/*", ""] },
            brackets: [["{", "}"], ["", "]"], ["("], "junk", 42, null],
            autoClosingPairs: [
                { open: "{", close: "}" },
                { open: "", close: ")" },
                { open: "(", close: "" },
                // Length checks would let this entry through; the type check rejects it.
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

    it("a non-array section (or null) counts as empty", () => {
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

    it("comments: null does not break parsing", () => {
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

describe("resolveLanguageConfiguration — onEnterRules", () => {
    it.each(["none", "indent", "indentOutdent", "outdent"] as const)("keeps the %s action whole", (indent) => {
        const action = { indent, appendText: "a", removeText: 2 };
        const [rule] = resolveLanguageConfiguration({ onEnterRules: [{ beforeText: "a", action }] }).onEnterRules;
        expect(rule.action).toStrictEqual(action);
    });

    it("no optional action fields stay absent", () => {
        const [rule] = resolveLanguageConfiguration({
            onEnterRules: [{ beforeText: "a", action: ENTER_NONE }],
        }).onEnterRules;
        expect(rule.action).toStrictEqual(ENTER_NONE);
    });

    it("a regex that is not a string or a pattern counts as absent", () => {
        const rules = resolveLanguageConfiguration({
            onEnterRules: [
                { beforeText: {}, action: ENTER_NONE },
                { beforeText: 5, action: ENTER_NONE },
                { beforeText: null, action: ENTER_NONE },
                { beforeText: "a", afterText: null, previousLineText: {}, action: ENTER_NONE },
            ],
        } as never).onEnterRules;
        expect(rules).toEqual([
            { beforeText: /a/, afterText: undefined, previousLineText: undefined, action: ENTER_NONE },
        ]);
    });

    it("takes a string or a pattern with flags", () => {
        const [first, second] = resolveLanguageConfiguration({
            onEnterRules: [
                { beforeText: "a", action: ENTER_NONE },
                {
                    beforeText: { pattern: "b", flags: "i" },
                    afterText: "c",
                    previousLineText: "d",
                    action: ENTER_INDENT,
                },
            ],
        }).onEnterRules;
        expect(first).toEqual({
            beforeText: /a/,
            afterText: undefined,
            previousLineText: undefined,
            action: ENTER_NONE,
        });
        expect(second).toEqual({ beforeText: /b/i, afterText: /c/, previousLineText: /d/, action: ENTER_INDENT });
    });

    it("drops a rule with a broken beforeText, action or indent, and only that rule", () => {
        const rules = resolveLanguageConfiguration({
            onEnterRules: [
                null,
                "rule",
                { beforeText: "(", action: ENTER_NONE },
                { action: ENTER_NONE },
                { beforeText: "a" },
                { beforeText: "a", action: null },
                { beforeText: "a", action: { indent: "sideways" } },
                { beforeText: "good", action: ENTER_NONE },
            ],
        } as never).onEnterRules;
        expect(rules.map((rule) => rule.beforeText.source)).toEqual(["good"]);
    });

    it("a broken optional regex is dropped on its own, junk action fields too", () => {
        const [rule] = resolveLanguageConfiguration({
            onEnterRules: [
                {
                    beforeText: "a",
                    afterText: "(",
                    previousLineText: "[",
                    action: { indent: "none", appendText: 1, removeText: "x" },
                },
            ],
        } as never).onEnterRules;
        expect(rule).toEqual({
            beforeText: /a/,
            afterText: undefined,
            previousLineText: undefined,
            action: ENTER_NONE,
        });
    });

    it("a section that is not an array resolves to no rules", () => {
        expect(resolveLanguageConfiguration({ onEnterRules: "x" } as never).onEnterRules).toEqual([]);
        expect(resolveLanguageConfiguration({}).onEnterRules).toEqual([]);
    });
});
