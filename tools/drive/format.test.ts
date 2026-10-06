import { DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import type { NodeSnapshot } from "@tuidom/inspector/protocol";
import { describe, expect, it } from "vitest";

import {
    cellInfo,
    colorHex,
    focusText,
    formatCell,
    screenText,
    selectedTreesText,
    styleNames,
    treeText,
} from "./format.ts";

function frame(lines: string[], cols: number): GridSnapshot {
    const cells = lines.flatMap((line) =>
        Array.from(line.padEnd(cols, " ")).map((char) => ({
            char,
            fg: DEFAULT_COLOR,
            bg: DEFAULT_COLOR,
            style: 0,
            width: 1,
        })),
    );
    return { cols, rows: lines.length, cursor: null, cells };
}

function node(type: string, extra: Partial<NodeSnapshot> = {}, children: NodeSnapshot[] = []): NodeSnapshot {
    return {
        nodeId: 0,
        type,
        box: { x: 0, y: 0, width: 10, height: 1 },
        style: { fg: 0, bg: 0 },
        children,
        ...extra,
    } as NodeSnapshot;
}

describe("colorHex / styleNames", () => {
    it("packed RGB → #rrggbb с ведущими нулями; сентинел → default", () => {
        expect(colorHex(0x00ff10)).toBe("#00ff10");
        expect(colorHex(0)).toBe("#000000");
        expect(colorHex(DEFAULT_COLOR)).toBe("default");
    });
    it("маска стиля → имена через +", () => {
        expect(styleNames(0)).toBe("none");
        expect(styleNames(StyleFlags.Bold | StyleFlags.Undercurl)).toBe("bold+undercurl");
    });
});

describe("cellInfo", () => {
    it("символ, код-пойнт, цвета, стиль", () => {
        const f = frame(["ab", "cd"], 2);
        f.cells[3] = { char: "", fg: 0x112233, bg: DEFAULT_COLOR, style: StyleFlags.Italic, width: 1 };
        const info = cellInfo(f, 1, 1);
        expect(info).toEqual({
            x: 1,
            y: 1,
            char: "",
            codePoint: "U+EB99",
            fg: "#112233",
            bg: "default",
            style: "italic",
            width: 1,
        });
        expect(formatCell(info)).toBe('1,1 "" U+EB99 fg=#112233 bg=default style=italic width=1');
        expect(cellInfo(f, 0, 0).codePoint).toBe("U+0061");
    });
    it("пустой символ (продолжение широкой ячейки) — без код-пойнта", () => {
        const f = frame(["a"], 1);
        f.cells[0] = { char: "", fg: 1, bg: 2, style: 0, width: 0 };
        expect(cellInfo(f, 0, 0).codePoint).toBe("");
    });
    it("вне кадра — ошибка", () => {
        const f = frame(["ab"], 2);
        expect(() => cellInfo(f, 2, 0)).toThrow("ячейка 2,0 вне кадра 2x1");
        expect(() => cellInfo(f, 0, 1)).toThrow("вне кадра");
        expect(() => cellInfo(f, -1, 0)).toThrow("вне кадра");
        expect(() => cellInfo(f, 0, -1)).toThrow("вне кадра");
        expect(() => cellInfo(f, 0.5, 0)).toThrow("вне кадра");
        expect(() => cellInfo(f, 0, 0.5)).toThrow("вне кадра");
    });
});

describe("screenText", () => {
    it("строки без хвостовых пробелов", () => {
        expect(screenText(frame(["ab  ", " c  "], 4), false)).toBe("ab\n c");
    });
    it("--numbered: линейка колонок и номера строк", () => {
        const text = screenText(frame(["x"], 12), true);
        expect(text.split("\n")).toEqual(["  |0····+····1·", " 0|x"]);
    });
});

describe("treeText / selectedTreesText", () => {
    const root = node("Body", { id: "workbench" }, [
        node("Editor", { focused: true, state: { dirty: true }, role: "textbox" } as Partial<NodeSnapshot>, [
            node("Leaf"),
        ]),
        node("Panel"),
    ]);

    it("отступы, id, роль, box, фокус; state только по запросу", () => {
        expect(treeText(root)).toBe(
            [
                "Body#workbench [0,0 10x1]",
                "  Editor@textbox [0,0 10x1] *focus",
                "    Leaf [0,0 10x1]",
                "  Panel [0,0 10x1]",
            ].join("\n"),
        );
        expect(treeText(root, { state: true })).toContain('Editor@textbox [0,0 10x1] *focus {"dirty":true}');
    });

    it("depth обрезает", () => {
        expect(treeText(root, { depth: 1 }).split("\n")).toHaveLength(3);
        expect(treeText(root, { depth: 0 })).toBe("Body#workbench [0,0 10x1]");
    });

    it("нет документа", () => {
        expect(treeText(null)).toBe("<нет документа>");
    });

    it("поддеревья совпадений; нет совпадений — сообщение", () => {
        expect(selectedTreesText(root, "Panel")).toBe("Panel [0,0 10x1]");
        expect(selectedTreesText(root, "Nope")).toBe("<нет узлов по селектору Nope>");
    });
});

describe("focusText", () => {
    it("путь до самого глубокого сфокусированного узла (флаг стоит только на листе)", () => {
        const root = node("Body", { id: "w" }, [
            node("A"),
            node("B", {}, [node("C", { focused: true } as Partial<NodeSnapshot>)]),
        ]);
        expect(focusText(root)).toBe("Body#w > B > C");
    });
    it("сам корень в фокусе", () => {
        expect(focusText(node("Body", { focused: true } as Partial<NodeSnapshot>))).toBe("Body");
    });
    it("нет фокуса / нет документа", () => {
        expect(focusText(node("Body"))).toBe("<нет фокуса>");
        expect(focusText(null)).toBe("<нет фокуса>");
    });
});
