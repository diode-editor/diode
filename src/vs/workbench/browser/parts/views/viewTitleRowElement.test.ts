import { describe, expect, it } from "vitest";

import { BoxConstraints, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";

import { ViewTitleRowElement } from "./viewTitleRowElement.ts";

const CHEVRON_EXPANDED = "";
const CHEVRON_COLLAPSED = "";

function layout(row: ViewTitleRowElement, width = 30): ViewTitleRowElement {
    row.layout(BoxConstraints.tight(new Size(width, 1)));
    return row;
}

function titleText(row: ViewTitleRowElement): string {
    return (row.querySelector("TextLabelElement") as TextLabelElement).getText();
}

describe("ViewTitleRowElement — название", () => {
    it("шеврон отражает свёрнутость", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} CHANGES`);
        row.setExpanded(false);
        expect(titleText(row)).toBe(` ${CHEVRON_COLLAPSED} CHANGES`);
    });

    it("без шеврона — только отступ и название", () => {
        const row = layout(new ViewTitleRowElement("SOURCE CONTROL", { chevron: false }));
        expect(titleText(row)).toBe(" SOURCE CONTROL");
        // Шеврона нет — свёрнутость не рисуется, но и не ломает строку.
        row.setExpanded(false);
        expect(titleText(row)).toBe(" SOURCE CONTROL");
    });

    it("setTitle меняет надпись, повтор того же — no-op", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        row.setTitle("GRAPH");
        expect(row.getTitle()).toBe("GRAPH");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} GRAPH`);
        row.setTitle("GRAPH");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} GRAPH`);
    });

    it("setExpanded в то же состояние — no-op", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        row.setExpanded(true);
        expect(row.isExpanded).toBe(true);
    });
});

describe("ViewTitleRowElement — зоны кнопок", () => {
    it("название, кнопки и ⋯ разложены по зонам в порядке справа налево", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.collapse", icon: "C" },
        ]);
        layout(row);

        // Ширина 30: ⋯ занимает 27..29, кнопки — 24..26 и 21..23.
        expect(row.hitZone(28)).toEqual({ kind: "menu" });
        expect(row.hitZone(25)).toEqual({ kind: "action", actionId: "cmd.collapse" });
        expect(row.hitZone(22)).toEqual({ kind: "action", actionId: "cmd.refresh" });
        expect(row.hitZone(2)).toEqual({ kind: "title" });
        expect(row.menuAnchorX).toBe(27);
    });

    it("узкий заголовок клипует кнопки — у схлопнутых зоны нет", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row, 4);
        expect(row.hitZone(3)).toEqual({ kind: "title" });
    });

    it("setActions тем же составом — no-op, другим — пересобирает зоны", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row);
        expect(row.hitZone(25)).toEqual({ kind: "action", actionId: "cmd.refresh" });

        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row);
        expect(row.hitZone(25)).toEqual({ kind: "action", actionId: "cmd.refresh" });

        row.setActions([]);
        layout(row);
        expect(row.hitZone(25)).toEqual({ kind: "title" });
        expect(row.hitZone(28)).toEqual({ kind: "menu" });
    });
});

describe("ViewTitleRowElement — скрытая кнопка «⋯»", () => {
    it("setMenuVisible(false) убирает кнопку и её зону, true — возвращает", () => {
        const row = new ViewTitleRowElement("OUTPUT", { chevron: false });
        row.setActions([{ id: "cmd.clear", icon: "C" }]);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "menu" });

        row.setMenuVisible(false);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "action", actionId: "cmd.clear" });
        // Повтор того же состояния — no-op.
        row.setMenuVisible(false);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "action", actionId: "cmd.clear" });

        row.setMenuVisible(true);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "menu" });
    });
});

describe("ViewTitleRowElement — виджет заголовка", () => {
    it("виджет встаёт между названием и кнопками и снимается обратно", () => {
        const row = new ViewTitleRowElement("OUTPUT", { chevron: false });
        const widget = new FillerElement();
        widget.id = "channel-picker";

        row.setTitleWidget(widget);
        layout(row);
        expect(row.querySelector("#channel-picker")).toBe(widget);
        expect(row.hitZone(28)).toEqual({ kind: "menu" });

        row.setTitleWidget(widget);
        expect(row.querySelector("#channel-picker")).toBe(widget);

        row.setTitleWidget(null);
        layout(row);
        expect(row.querySelector("#channel-picker")).toBeNull();
    });
});
