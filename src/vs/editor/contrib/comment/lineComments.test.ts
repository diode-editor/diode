import { describe, expect, it } from "vitest";

import { planLineComments, remapPositionForShifts } from "./lineComments.ts";

function plan(lines: string[], which: number[], mode: "toggle" | "add" | "remove" = "toggle", token = "//") {
    return planLineComments((line) => lines[line], which, token, mode);
}

function apply(lines: string[], which: number[], mode: "toggle" | "add" | "remove" = "toggle", token = "//") {
    const result = [...lines];
    const p = plan(lines, which, mode, token);
    if (p === null) return result;
    // Edits never overlap on a line: a plan has at most one edit per line.
    for (const edit of p.edits) {
        const { start, end } = edit.range;
        result[start.line] =
            result[start.line].slice(0, start.character) + edit.text + result[end.line].slice(end.character);
    }
    return result;
}

describe("planLineComments — toggle", () => {
    it("comments an uncommented line with a space after the marker", () => {
        expect(apply(["const a = 1;"], [0])).toEqual(["// const a = 1;"]);
    });

    it("removes the marker together with one space after it", () => {
        expect(apply(["// const a = 1;"], [0])).toEqual(["const a = 1;"]);
    });

    it("removes the marker without a space after it too", () => {
        expect(apply(["//const a = 1;"], [0])).toEqual(["const a = 1;"]);
    });

    it("marker goes in a single column: the minimal indent of non-empty lines", () => {
        expect(apply(["    a();", "        b();", "    c();"], [0, 1, 2])).toEqual([
            "    // a();",
            "    //     b();",
            "    // c();",
        ]);
    });

    it("empty lines are not commented and do not affect analysis", () => {
        expect(apply(["a();", "", "b();"], [0, 1, 2])).toEqual(["// a();", "", "// b();"]);
    });

    it("partially commented block gets fully commented (toggle by state of all lines)", () => {
        expect(apply(["// a();", "b();"], [0, 1])).toEqual(["// // a();", "// b();"]);
    });

    it("fully commented block gets uncommented, empty lines are untouched", () => {
        expect(apply(["// a();", "", "// b();"], [0, 1, 2])).toEqual(["a();", "", "b();"]);
    });

    it("block of only empty lines is commented entirely", () => {
        expect(apply(["", ""], [0, 1])).toEqual(["// ", "// "]);
    });

    it("indent is measured in tabs too", () => {
        expect(apply(["\tfoo", "\t\tbar"], [0, 1], "toggle", "#")).toEqual(["\t# foo", "\t# \tbar"]);
    });

    it("line with the marker not at content start counts as uncommented", () => {
        expect(apply(["a(); // tail"], [0])).toEqual(["// a(); // tail"]);
    });
});

describe("planLineComments — add / remove", () => {
    it("add adds the marker even to an already commented line", () => {
        expect(apply(["// a();"], [0], "add")).toEqual(["// // a();"]);
    });

    it("remove strips markers only from commented lines", () => {
        expect(apply(["// a();", "b();"], [0, 1], "remove")).toEqual(["a();", "b();"]);
    });

    it("remove without any marker yields no edits", () => {
        expect(plan(["a();", "b();"], [0, 1], "remove")).toBeNull();
    });

    it("add on only empty lines yields no edits (only toggle comments empty lines)", () => {
        expect(plan(["", "  "], [0, 1], "add")).toBeNull();
        expect(plan(["", "  "], [0, 1], "remove")).toBeNull();
    });
});

describe("remapPositionForShifts", () => {
    const insert = [{ line: 0, column: 4, delta: 3 }];
    const remove = [{ line: 0, column: 4, delta: -3 }];

    it("insert: points left of the column and at zero stay, at the column and right of it shift", () => {
        expect(remapPositionForShifts({ line: 0, character: 2 }, insert)).toEqual({ line: 0, character: 2 });
        expect(remapPositionForShifts({ line: 0, character: 0 }, insert)).toEqual({ line: 0, character: 0 });
        expect(remapPositionForShifts({ line: 0, character: 4 }, insert)).toEqual({ line: 0, character: 7 });
        expect(remapPositionForShifts({ line: 0, character: 9 }, insert)).toEqual({ line: 0, character: 12 });
    });

    it("insert at column 0 does not drag the cursor off line start", () => {
        const atZero = [{ line: 0, column: 0, delta: 3 }];
        expect(remapPositionForShifts({ line: 0, character: 0 }, atZero)).toEqual({ line: 0, character: 0 });
        expect(remapPositionForShifts({ line: 0, character: 1 }, atZero)).toEqual({ line: 0, character: 4 });
    });

    it("delete: inside the chunk clamps to its start, right of it shifts left", () => {
        expect(remapPositionForShifts({ line: 0, character: 4 }, remove)).toEqual({ line: 0, character: 4 });
        expect(remapPositionForShifts({ line: 0, character: 6 }, remove)).toEqual({ line: 0, character: 4 });
        expect(remapPositionForShifts({ line: 0, character: 10 }, remove)).toEqual({ line: 0, character: 7 });
    });

    it("other lines are untouched", () => {
        expect(remapPositionForShifts({ line: 1, character: 6 }, insert)).toEqual({ line: 1, character: 6 });
    });
});
