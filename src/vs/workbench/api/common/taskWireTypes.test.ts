import { describe, expect, it } from "vitest";

import {
    parseWireTask,
    parseWireTaskEnded,
    parseWireTaskExecution,
    parseWireTaskProcessEnded,
    parseWireTaskProcessStarted,
    parseWireTasks,
    parseWireTaskStarted,
} from "./taskWireTypes.ts";

// Разбор в субпроцессе того, что о задачах присылает ядро.

const task = { name: "b", definition: { type: "t" }, source: { label: "s", extensionId: "e", scope: 2 } };

describe("разбор задач ядра в субпроцессе", () => {
    it("задача: имя, определение с типом и источник — иначе null", () => {
        expect(parseWireTask(task)).toBe(task);
        expect(parseWireTask({ ...task, name: 1 })).toBeNull();
        expect(parseWireTask({ ...task, definition: { type: 1 } })).toBeNull();
        expect(parseWireTask({ ...task, definition: null })).toBeNull();
        expect(parseWireTask({ ...task, source: "s" })).toBeNull();
        expect(parseWireTask(null)).toBeNull();
        expect(parseWireTasks([task, 1])).toStrictEqual([task]);
        expect(parseWireTasks({})).toStrictEqual([]);
    });

    it("исполнение: строковый id и задача", () => {
        expect(parseWireTaskExecution({ id: "x", task })).toStrictEqual({ id: "x", task });
        expect(parseWireTaskExecution({ id: 1, task })).toBeNull();
        expect(parseWireTaskExecution({ id: "x", task: {} })).toBeNull();
        expect(parseWireTaskExecution(undefined)).toBeNull();
    });

    it("старт: терминал числом; без определения с подстановкой — определение задачи", () => {
        expect(
            parseWireTaskStarted({ execution: { id: "x", task }, terminalId: 3, resolvedDefinition: { type: "r" } }),
        ).toStrictEqual({
            execution: { id: "x", task },
            terminalId: 3,
            resolvedDefinition: { type: "r" },
        });
        expect(parseWireTaskStarted({ execution: { id: "x", task }, terminalId: 3 })?.resolvedDefinition).toBe(
            task.definition,
        );
        expect(parseWireTaskStarted({ execution: { id: "x", task }, terminalId: "3" })).toBeNull();
        expect(parseWireTaskStarted({ execution: {}, terminalId: 3 })).toBeNull();
        expect(parseWireTaskStarted(null)).toBeNull();
    });

    it("процесс: старт с pid, конец с кодом или без", () => {
        expect(parseWireTaskProcessStarted({ id: "x", processId: 1 })).toStrictEqual({ id: "x", processId: 1 });
        expect(parseWireTaskProcessStarted({ id: "x", processId: "1" })).toBeNull();
        expect(parseWireTaskProcessStarted({ id: 1, processId: 1 })).toBeNull();
        expect(parseWireTaskProcessEnded({ id: "x", exitCode: 0 })).toStrictEqual({ id: "x", exitCode: 0 });
        expect(parseWireTaskProcessEnded({ id: "x", exitCode: "0" })).toStrictEqual({ id: "x" });
        expect(parseWireTaskProcessEnded({ id: 2 })).toBeNull();
    });

    it("конец: исполнение", () => {
        expect(parseWireTaskEnded({ execution: { id: "x", task } })).toStrictEqual({ execution: { id: "x", task } });
        expect(parseWireTaskEnded({ execution: null })).toBeNull();
        expect(parseWireTaskEnded(7)).toBeNull();
        expect(parseWireTaskEnded(null)).toBeNull();
    });
});
