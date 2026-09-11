import { describe, expect, it } from "vitest";

import { chordsEqual, parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { appendKeybindingRule, removeKeybindingRules } from "./keybindingsFileEditor.ts";

/** Фикстура с комментариями и trailing comma — то, что реально пишут руками. */
const FIXTURE = `[
    // мой любимый бинд
    { "key": "ctrl+h", "command": "editor.action.startFindReplaceAction" },
    { "key": "f6", "command": "custom.command", "when": "textViewFocus" },
]
`;

describe("appendKeybindingRule", () => {
    it("дописывает правило в конец, сохраняя комментарии", () => {
        const next = appendKeybindingRule(FIXTURE, { key: "ctrl+k ctrl+u", command: "editor.action.showHover" });

        expect(next).toContain("// мой любимый бинд");
        expect(next).toContain('"key": "ctrl+k ctrl+u"');
        expect(next).toContain('"command": "editor.action.showHover"');
        // Прежние правила на месте.
        expect(next).toContain("startFindReplaceAction");
        expect(next.indexOf("showHover")).toBeGreaterThan(next.indexOf("custom.command"));
    });

    it("when пишется только когда он есть", () => {
        const withWhen = appendKeybindingRule("[]\n", { key: "f7", command: "a.b", when: "listFocus" });
        expect(withWhen).toContain('"when": "listFocus"');

        const withoutWhen = appendKeybindingRule("[]\n", { key: "f7", command: "a.b" });
        expect(withoutWhen).not.toContain('"when"');
    });

    it("пустой и отсутствующий файл стартует с пустого массива", () => {
        for (const content of ["", "   \n"]) {
            const next = appendKeybindingRule(content, { key: "f7", command: "a.b" });
            expect(next).toContain('"key": "f7"');
            expect(next.trim().startsWith("[")).toBe(true);
        }
    });
});

describe("removeKeybindingRules", () => {
    it("удаляет только совпавшие правила, комментарии остальных сохраняются", () => {
        const next = removeKeybindingRules(FIXTURE, (rule) => rule.command === "custom.command");

        expect(next).not.toContain("custom.command");
        expect(next).toContain("startFindReplaceAction");
        expect(next).toContain("// мой любимый бинд");
    });

    it("матчит по разобранной комбинации, а не по строке", () => {
        // "Ctrl+H" и "ctrl+h" — одна комбинация.
        const next = removeKeybindingRules(FIXTURE, (rule) => chordsEqual(parseChord(rule.key), parseChord("Ctrl+H")));

        expect(next).not.toContain("startFindReplaceAction");
        expect(next).toContain("custom.command");
    });

    it("удаление нескольких правил не путает индексы", () => {
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

    it("толерантна к мусору: не-объекты и правила без command не роняют операцию", () => {
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

    it("правило без key (unbind-all) предикату приходит с пустой строкой", () => {
        const content = `[
    { "command": "-test.save" },
    { "key": "f6", "command": "custom.command" }
]
`;
        const next = removeKeybindingRules(content, (rule) => rule.key === "" && rule.command === "-test.save");

        expect(next).not.toContain("-test.save");
        expect(next).toContain("custom.command");
    });

    it("файл не-массив возвращается как есть", () => {
        const content = '{ "not": "an array" }\n';
        expect(removeKeybindingRules(content, () => true)).toBe(content);
    });
});
