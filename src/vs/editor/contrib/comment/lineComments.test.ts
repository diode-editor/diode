import { describe, expect, it } from "vitest";

import { planLineComments, remapPositionForShifts } from "./lineComments.ts";

function plan(lines: string[], which: number[], mode: "toggle" | "add" | "remove" = "toggle", token = "//") {
    return planLineComments((line) => lines[line], which, token, mode);
}

/** Применяет план к строкам — ассертим наблюдаемый текст, а не устройство правок. */
function apply(lines: string[], which: number[], mode: "toggle" | "add" | "remove" = "toggle", token = "//") {
    const result = [...lines];
    const p = plan(lines, which, mode, token);
    if (p === null) return result;
    // Правки одной строки не пересекаются: у плана максимум одна правка на строку.
    for (const edit of p.edits) {
        const { start, end } = edit.range;
        result[start.line] =
            result[start.line].slice(0, start.character) + edit.text + result[end.line].slice(end.character);
    }
    return result;
}

describe("planLineComments — toggle", () => {
    it("комментирует раскомментированную строку с пробелом после маркера", () => {
        expect(apply(["const a = 1;"], [0])).toEqual(["// const a = 1;"]);
    });

    it("снимает маркер вместе с одним пробелом после него", () => {
        expect(apply(["// const a = 1;"], [0])).toEqual(["const a = 1;"]);
    });

    it("снимает маркер и без пробела после него", () => {
        expect(apply(["//const a = 1;"], [0])).toEqual(["const a = 1;"]);
    });

    it("маркер уходит единой колонкой — минимальным отступом значимых строк", () => {
        expect(apply(["    a();", "        b();", "    c();"], [0, 1, 2])).toEqual([
            "    // a();",
            "    //     b();",
            "    // c();",
        ]);
    });

    it("пустые строки не комментируются и не мешают анализу", () => {
        expect(apply(["a();", "", "b();"], [0, 1, 2])).toEqual(["// a();", "", "// b();"]);
    });

    it("частично закомментированный блок докомментируется (toggle по состоянию всех строк)", () => {
        expect(apply(["// a();", "b();"], [0, 1])).toEqual(["// // a();", "// b();"]);
    });

    it("полностью закомментированный блок раскомментируется, пустые строки не трогаются", () => {
        expect(apply(["// a();", "", "// b();"], [0, 1, 2])).toEqual(["a();", "", "b();"]);
    });

    it("блок из одних пустых строк комментируется целиком", () => {
        expect(apply(["", ""], [0, 1])).toEqual(["// ", "// "]);
    });

    it("отступ учитывается и в табах", () => {
        expect(apply(["\tfoo", "\t\tbar"], [0, 1], "toggle", "#")).toEqual(["\t# foo", "\t# \tbar"]);
    });

    it("строка, где маркер стоит не в начале содержимого, считается незакомментированной", () => {
        expect(apply(["a(); // хвост"], [0])).toEqual(["// a(); // хвост"]);
    });
});

describe("planLineComments — add / remove", () => {
    it("add добавляет маркер даже на уже закомментированную строку", () => {
        expect(apply(["// a();"], [0], "add")).toEqual(["// // a();"]);
    });

    it("remove снимает маркеры только с закомментированных строк", () => {
        expect(apply(["// a();", "b();"], [0, 1], "remove")).toEqual(["a();", "b();"]);
    });

    it("remove без единого маркера — правок нет", () => {
        expect(plan(["a();", "b();"], [0, 1], "remove")).toBeNull();
    });

    it("add на одних пустых строках — правок нет (пустые комментирует только toggle)", () => {
        expect(plan(["", "  "], [0, 1], "add")).toBeNull();
        expect(plan(["", "  "], [0, 1], "remove")).toBeNull();
    });
});

describe("remapPositionForShifts", () => {
    const insert = [{ line: 0, column: 4, delta: 3 }];
    const remove = [{ line: 0, column: 4, delta: -3 }];

    it("вставка: точка левее колонки и на нуле не трогаются, на колонке и правее — едут", () => {
        expect(remapPositionForShifts({ line: 0, character: 2 }, insert)).toEqual({ line: 0, character: 2 });
        expect(remapPositionForShifts({ line: 0, character: 0 }, insert)).toEqual({ line: 0, character: 0 });
        expect(remapPositionForShifts({ line: 0, character: 4 }, insert)).toEqual({ line: 0, character: 7 });
        expect(remapPositionForShifts({ line: 0, character: 9 }, insert)).toEqual({ line: 0, character: 12 });
    });

    it("вставка в колонку 0 не утаскивает каретку с начала строки", () => {
        const atZero = [{ line: 0, column: 0, delta: 3 }];
        expect(remapPositionForShifts({ line: 0, character: 0 }, atZero)).toEqual({ line: 0, character: 0 });
        expect(remapPositionForShifts({ line: 0, character: 1 }, atZero)).toEqual({ line: 0, character: 4 });
    });

    it("удаление: внутри куска — прижимается к началу, правее — едет влево", () => {
        expect(remapPositionForShifts({ line: 0, character: 4 }, remove)).toEqual({ line: 0, character: 4 });
        expect(remapPositionForShifts({ line: 0, character: 6 }, remove)).toEqual({ line: 0, character: 4 });
        expect(remapPositionForShifts({ line: 0, character: 10 }, remove)).toEqual({ line: 0, character: 7 });
    });

    it("чужая строка не трогается", () => {
        expect(remapPositionForShifts({ line: 1, character: 6 }, insert)).toEqual({ line: 1, character: 6 });
    });
});
