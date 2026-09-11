import { parse as parseJsonc } from "jsonc-parser";
import { describe, expect, it } from "vitest";

import { chordsEqual, parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { appendKeybindingRule, removeKeybindingRules } from "./keybindingsFileEditor.ts";

function rules(content: string): { key?: string; command: string; when?: string }[] {
    return parseJsonc(content, [], { allowTrailingComma: true }) as { key?: string; command: string; when?: string }[];
}

/** Фикстура с комментариями и trailing comma — то, что реально пишут руками. */
const FIXTURE = `[
    // мой любимый бинд
    { "key": "ctrl+h", "command": "editor.action.startFindReplaceAction" },
    { "key": "f6", "command": "custom.command", "when": "textViewFocus" },
]
`;

describe("appendKeybindingRule", () => {
    it("дописывает правило в конец, сохраняя комментарии и прежние правила", () => {
        const next = appendKeybindingRule(FIXTURE, { key: "ctrl+k ctrl+u", command: "editor.action.showHover" });

        expect(next).toContain("// мой любимый бинд");
        // Добавление (insertion), а не перезапись последнего: было 2 правила — стало 3.
        const parsed = rules(next);
        expect(parsed).toHaveLength(3);
        expect(parsed.map((r) => r.command)).toEqual([
            "editor.action.startFindReplaceAction",
            "custom.command",
            "editor.action.showHover",
        ]);
        expect(parsed[2].key).toBe("ctrl+k ctrl+u");
    });

    it("when пишется только когда он есть", () => {
        const withWhen = appendKeybindingRule("[]\n", { key: "f7", command: "a.b", when: "listFocus" });
        expect(withWhen).toContain('"when": "listFocus"');

        const withoutWhen = appendKeybindingRule("[]\n", { key: "f7", command: "a.b" });
        expect(withoutWhen).not.toContain('"when"');
    });

    it("пустой и пробельный файл стартует с валидного пустого массива", () => {
        for (const content of ["", "   \n\t "]) {
            const next = appendKeybindingRule(content, { key: "f7", command: "a.b" });
            // Ровно одно правило в валидном массиве (не мусор, не перезапись).
            const parsed = rules(next);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed).toHaveLength(1);
            expect(parsed[0]).toMatchObject({ key: "f7", command: "a.b" });
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

    it("предикат видит правила нормализованными: when пустой/отсутствующий → undefined, key → строка", () => {
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

        // Не-объект (5), правило без command ({key:"orphan"}) и с пустым command
        // до предиката не доходят.
        expect(seen.map((r) => r.command)).toEqual(["a", "b", "c", "d"]);
        // when: непустая строка сохраняется; пустая, отсутствующая и НЕ-строка → undefined.
        expect(seen.map((r) => r.when)).toEqual(["listFocus", undefined, undefined, undefined]);
        // key: строка сохраняется; отсутствующая и НЕ-строка → "".
        expect(seen.map((r) => r.key)).toEqual(["ctrl+s", "", "", ""]);
    });

    it("непустое содержимое не сбрасывается в пустой массив", () => {
        const content = '[{ "key": "ctrl+s", "command": "keep" }]\n';

        // predicate=false ничего не удаляет — но ensureArrayContent не должен затереть файл.
        expect(removeKeybindingRules(content, () => false)).toContain("keep");
    });
});
