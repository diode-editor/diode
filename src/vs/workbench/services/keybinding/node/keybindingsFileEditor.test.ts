import { parse as parseJsonc } from "jsonc-parser";
import { describe, expect, it } from "vitest";

import { chordsEqual, parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { appendKeybindingRule, removeKeybindingRules } from "./keybindingsFileEditor.ts";

function rules(content: string): { key?: string; command: string; when?: string }[] {
    return parseJsonc(content, [], { allowTrailingComma: true }) as { key?: string; command: string; when?: string }[];
}

/** A fixture with comments and a trailing comma — what people actually write by hand. */
const FIXTURE = `[
    // my favourite binding
    { "key": "ctrl+h", "command": "editor.action.startFindReplaceAction" },
    { "key": "f6", "command": "custom.command", "when": "textViewFocus" },
]
`;

describe("appendKeybindingRule", () => {
    it("appends the rule at the end, keeping comments and existing rules", () => {
        const next = appendKeybindingRule(FIXTURE, { key: "ctrl+k ctrl+u", command: "editor.action.showHover" });

        expect(next).toContain("// my favourite binding");
        // An insertion, not an overwrite of the last one.
        const parsed = rules(next);
        expect(parsed).toHaveLength(3);
        expect(parsed.map((r) => r.command)).toEqual([
            "editor.action.startFindReplaceAction",
            "custom.command",
            "editor.action.showHover",
        ]);
        expect(parsed[2].key).toBe("ctrl+k ctrl+u");
    });

    it("when is written only when present", () => {
        const withWhen = appendKeybindingRule("[]\n", { key: "f7", command: "a.b", when: "listFocus" });
        expect(withWhen).toContain('"when": "listFocus"');

        const withoutWhen = appendKeybindingRule("[]\n", { key: "f7", command: "a.b" });
        expect(withoutWhen).not.toContain('"when"');
    });

    it("args is written only when present, in any shape", () => {
        const withArgs = appendKeybindingRule("[]\n", { key: "f7", command: "a.b", args: { text: "src/" } });
        const parsedWithArgs = parseJsonc(withArgs, [], { allowTrailingComma: true }) as { args?: unknown }[];
        expect(parsedWithArgs[0].args).toEqual({ text: "src/" });

        const withoutArgs = appendKeybindingRule("[]\n", { key: "f7", command: "a.b" });
        expect(withoutArgs).not.toContain('"args"');
    });

    it("an empty or whitespace file starts from a valid empty array", () => {
        for (const content of ["", "   \n\t "]) {
            const next = appendKeybindingRule(content, { key: "f7", command: "a.b" });
            const parsed = rules(next);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed).toHaveLength(1);
            expect(parsed[0]).toMatchObject({ key: "f7", command: "a.b" });
        }
    });
});

describe("removeKeybindingRules", () => {
    it("removes only matching rules, comments of the others stay", () => {
        const next = removeKeybindingRules(FIXTURE, (rule) => rule.command === "custom.command");

        expect(next).not.toContain("custom.command");
        expect(next).toContain("startFindReplaceAction");
        expect(next).toContain("// my favourite binding");
    });

    it("matches by the parsed chord, not by the string", () => {
        const next = removeKeybindingRules(FIXTURE, (rule) => chordsEqual(parseChord(rule.key), parseChord("Ctrl+H")));

        expect(next).not.toContain("startFindReplaceAction");
        expect(next).toContain("custom.command");
    });

    it("removing several rules does not mix up indices", () => {
        const content = `[
    { "key": "f1", "command": "doomed" },
    { "key": "f2", "command": "keeper" },
    { "key": "f3", "command": "doomed" },
]
`;
        const next = removeKeybindingRules(content, (rule) => rule.command === "doomed");

        expect(next).not.toContain("doomed");
        expect(next).toContain("keeper");
    });

    it("tolerates garbage: non-objects and rules without command do not fail the operation", () => {
        const content = `[
    42,
    { "note": "no command here" },
    { "key": "f6", "command": "custom.command" }
]
`;
        const next = removeKeybindingRules(content, (rule) => rule.command === "custom.command");

        expect(next).not.toContain("custom.command");
        expect(next).toContain("42");
    });

    it("a rule without key (unbind-all) reaches the predicate with an empty string", () => {
        const content = `[
    { "command": "-test.save" },
    { "key": "f6", "command": "custom.command" }
]
`;
        const next = removeKeybindingRules(content, (rule) => rule.key === "" && rule.command === "-test.save");

        expect(next).not.toContain("-test.save");
        expect(next).toContain("custom.command");
    });

    it("a non-array file is returned as is", () => {
        const content = '{ "not": "an array" }\n';
        expect(removeKeybindingRules(content, () => true)).toBe(content);
    });

    it("the predicate sees normalized rules: empty/missing when → undefined, key → string", () => {
        const content = `[
    { "key": "ctrl+s", "command": "a", "when": "listFocus" },
    { "key": "", "command": "b", "when": "" },
    { "command": "c" },
    { "key": 9, "command": "d", "when": 5 },
    5,
    null,
    { "key": "orphan" },
    { "command": "" }
]
`;
        const seen: { key: unknown; command: string; when: unknown }[] = [];
        removeKeybindingRules(content, (rule) => {
            seen.push({ key: rule.key, command: rule.command, when: rule.when });
            return false;
        });

        // A non-object (5), a rule without command ({key:"orphan"}) and one with an empty
        // command never reach the predicate.
        expect(seen.map((r) => r.command)).toEqual(["a", "b", "c", "d"]);
        expect(seen.map((r) => r.when)).toEqual(["listFocus", undefined, undefined, undefined]);
        expect(seen.map((r) => r.key)).toEqual(["ctrl+s", "", "", ""]);
    });

    it("non-empty content is not reset to an empty array", () => {
        const content = '[{ "key": "ctrl+s", "command": "keep" }]\n';

        expect(removeKeybindingRules(content, () => false)).toContain("keep");
    });
});
