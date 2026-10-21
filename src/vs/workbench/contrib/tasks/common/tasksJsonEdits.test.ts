import { describe, expect, it } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";

import {
    appendTaskEntry,
    applyTaskTemplate,
    customizationEntryOf,
    expandTemplateTabs,
    isWritableTasksJson,
    newTasksJsonWith,
    taskEntryRange,
    tasksJsonHasTasks,
} from "./tasksJsonEdits.ts";
import { getTaskTemplates } from "./taskTemplates.ts";

const spaces4 = { insertSpaces: true, tabSize: 4 };
const tabs = { insertSpaces: false, tabSize: 4 };
const entry = { type: "npm", script: "lint" };

describe("appendTaskEntry", () => {
    it("пустой массив в одну строку — запись отдельными строками с отступом от строки массива", () => {
        const result = appendTaskEntry('{\n  "version": "2.0.0",\n  "tasks": []\n}', entry, {
            insertSpaces: true,
            tabSize: 2,
        });
        expect(result).toStrictEqual({
            text: '{\n  "version": "2.0.0",\n  "tasks": [\n    {\n      "type": "npm",\n      "script": "lint"\n    }\n  ]\n}',
            index: 0,
        });
    });

    it("пустой массив с комментарием внутри — комментарий остаётся перед записью", () => {
        const text = '{\n\t"version": "2.0.0",\n\t"tasks": [\n\t\t// пока пусто\n\t]\n}';
        expect(appendTaskEntry(text, entry, tabs).text).toBe(
            '{\n\t"version": "2.0.0",\n\t"tasks": [\n\t\t// пока пусто\n\t\t{\n\t\t\t"type": "npm",\n\t\t\t"script": "lint"\n\t\t}\n\t]\n}',
        );
    });

    it("висячая запятая после последней записи — вторую не ставим; индекс — длина массива", () => {
        const text = '{ "version": "2.0.0", "tasks": [\n    { "label": "a" },\n    { "label": "b" },\n] }';
        const result = appendTaskEntry(text, entry, spaces4);
        expect(result.index).toBe(2);
        expect(result.text).toBe(
            '{ "version": "2.0.0", "tasks": [\n    { "label": "a" },\n    { "label": "b" },\n    {\n        "type": "npm",\n        "script": "lint"\n    }\n] }',
        );
    });

    it("запись на одной строке с `[` — отступ от строки массива плюс шаг; CRLF сохраняется", () => {
        const text = '{\r\n    "version": "2.0.0",\r\n    "tasks": [{ "label": "a" }]\r\n}';
        expect(appendTaskEntry(text, { a: 1 }, spaces4).text).toBe(
            '{\r\n    "version": "2.0.0",\r\n    "tasks": [{ "label": "a" },\r\n        {\r\n            "a": 1\r\n        }\r\n    ]\r\n}',
        );
    });

    it("нет tasks — массив заводится; нет version — ставится 2.0.0; пустой текст — новый файл", () => {
        const noTasks = appendTaskEntry('{\n    "version": "2.0.0"\n}', entry, spaces4);
        expect(noTasks.index).toBe(0);
        expect(JSON.parse(noTasks.text)).toStrictEqual({ version: "2.0.0", tasks: [entry] });
        const noVersion = appendTaskEntry('{ "tasks": [] }', entry, spaces4);
        expect(JSON.parse(noVersion.text)).toStrictEqual({ tasks: [entry], version: "2.0.0" });
        const notArray = appendTaskEntry('{ "version": "2.0.0", "tasks": 1 }', entry, spaces4);
        expect(JSON.parse(notArray.text)).toStrictEqual({ version: "2.0.0", tasks: [entry] });
        expect(appendTaskEntry("  \n", entry, spaces4)).toStrictEqual({
            text: newTasksJsonWith(entry, spaces4),
            index: 0,
        });
    });

    it("отступ — как у последней записи на своей строке, даже не кратный шагу; чужая версия не трогается", () => {
        const text = '{\n  "version": "0.1.0",\n  "tasks": [\n      {"a": 1}\n  ]\n}';
        expect(appendTaskEntry(text, { b: 2 }, { insertSpaces: true, tabSize: 2 }).text).toBe(
            '{\n  "version": "0.1.0",\n  "tasks": [\n      {"a": 1},\n      {\n        "b": 2\n      }\n  ]\n}',
        );
    });

    it("запись делит строку с `[` и переносит `{` — отступ от массива; запятая после `]` не считается", () => {
        const text = '{\n  "version": "2.0.0",\n  "tasks": [{\n    "a": 1\n  }],\n  "x": [1, 2]\n}';
        expect(appendTaskEntry(text, { b: 2 }, { insertSpaces: true, tabSize: 2 }).text).toBe(
            '{\n  "version": "2.0.0",\n  "tasks": [{\n    "a": 1\n  },\n    {\n      "b": 2\n    }\n  ],\n  "x": [1, 2]\n}',
        );
    });
});

describe("шаблоны и новый файл", () => {
    it("newTasksJsonWith — шапка эталона и 2.0.0; отступ табами или пробелами", () => {
        expect(newTasksJsonWith({ a: 1 }, tabs)).toBe(
            '{\n\t// See https://go.microsoft.com/fwlink/?LinkId=733558 \n\t// for the documentation about the tasks.json format\n\t"version": "2.0.0",\n\t"tasks": [\n\t\t{\n\t\t\t"a": 1\n\t\t}\n\t]\n}',
        );
        expect(newTasksJsonWith({ a: 1 }, { insertSpaces: true, tabSize: 2 })).toContain('\n      "a": 1\n');
    });

    it("expandTemplateTabs — только ведущие табы строк, по tabSize; без insertSpaces — как есть", () => {
        expect(expandTemplateTabs('{\n\t\t"a": "\\t"\t}', { insertSpaces: true, tabSize: 3 })).toBe(
            '{\n      "a": "\\t"\t}',
        );
        expect(expandTemplateTabs("{\n\t}", tabs)).toBe("{\n\t}");
    });

    it("applyTaskTemplate — пустой файл получает шаблон; иначе ключи шаблона поверх", () => {
        const [, , , others] = getTaskTemplates();
        expect(applyTaskTemplate("", others.content, tabs)).toBe(others.content);
        expect(applyTaskTemplate(" \n", others.content, tabs)).toBe(others.content);
        expect(applyTaskTemplate('{\n    "x": 1\n}', others.content, spaces4)).toContain('\n    "version": "2.0.0",\n');
        const merged = applyTaskTemplate('{ "version": "1.0.0", "x": 1 }', others.content, spaces4);
        expect(JSON.parse(merged)).toStrictEqual({
            version: "2.0.0",
            x: 1,
            tasks: [{ label: "echo", type: "shell", command: "echo Hello" }],
        });
    });

    it("getTaskTemplates — порядок эталона: по sort/label, «Others» последним", () => {
        expect(getTaskTemplates().map((t) => t.id)).toStrictEqual([
            "msbuild",
            "maven",
            "dotnetCore",
            "externalCommand",
        ]);
    });
});

describe("разбор и поиск", () => {
    it("isWritableTasksJson / tasksJsonHasTasks", () => {
        expect(isWritableTasksJson("")).toBe(true);
        expect(isWritableTasksJson("{ // c\n }")).toBe(true);
        expect(isWritableTasksJson('{ "a": 1, }')).toBe(true);
        expect(isWritableTasksJson(" \n\t")).toBe(true);
        expect(isWritableTasksJson("5")).toBe(false);
        expect(isWritableTasksJson("{ oops")).toBe(false);
        expect(isWritableTasksJson("[]")).toBe(false);
        expect(isWritableTasksJson("null")).toBe(false);
        expect(tasksJsonHasTasks('{ "tasks": [1] }')).toBe(true);
        expect(tasksJsonHasTasks('{ "tasks": [] }')).toBe(false);
        expect(tasksJsonHasTasks('{ "tasks": {} }')).toBe(false);
        expect(tasksJsonHasTasks("{ oops")).toBe(false);
    });

    it("taskEntryRange — смещения записи; нет записи или текста — undefined", () => {
        const text = '{ "tasks": [ {"a":1}, {"b":2} ] }';
        expect(taskEntryRange(text, 1)).toStrictEqual({ start: text.indexOf('{"b"'), end: text.indexOf('{"b"') + 7 });
        expect(taskEntryRange(text, 2)).toBeUndefined();
        expect(taskEntryRange(text, -1)).toBeUndefined();
        expect(taskEntryRange("", 0)).toBeUndefined();
    });
});

describe("customizationEntryOf", () => {
    const npm = (extra: Parameters<typeof makeTask>[0] = {}) =>
        makeTask({
            label: "build",
            extension: { type: "npm", extensionId: "pub.ext", source: "npm" },
            definition: { script: "build", path: "sub" },
            ...extra,
        });

    it("определение без _key, пустые матчеры, подпись задачи; без группы и подробности — без ключей", () => {
        expect(customizationEntryOf(npm())).toStrictEqual({
            type: "npm",
            script: "build",
            path: "sub",
            problemMatcher: [],
            label: "npm: build",
        });
    });

    it("матчеры, группа (по умолчанию — объектом, иначе строкой) и подробность провайдера переносятся", () => {
        const withAll = {
            ...npm({ detail: "tsc" }),
            problemMatchers: ["$tsc"],
            group: { id: "build", isDefault: true },
        };
        expect(customizationEntryOf(withAll)).toMatchObject({
            problemMatcher: ["$tsc"],
            group: { kind: "build", isDefault: true },
            detail: "tsc",
        });
        expect(customizationEntryOf({ ...npm(), group: { id: "test", isDefault: false } }).group).toBe("test");
        expect(customizationEntryOf({ ...npm(), group: { id: "test" } }).group).toBe("test");
    });
});
