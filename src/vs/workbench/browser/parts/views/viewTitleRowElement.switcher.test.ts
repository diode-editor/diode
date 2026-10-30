import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { ViewTitleRowElement } from "./viewTitleRowElement.ts";

// nf-fa-angle_down, the section chevron's glyph.
const CHEVRON = "";

function layout(row: ViewTitleRowElement, width = 30): ViewTitleRowElement {
    row.layout(BoxConstraints.tight(new Size(width, 1)));
    return row;
}

function titleText(row: ViewTitleRowElement): string {
    // The switcher chevron is a label of its own, right after the title.
    const switcher = row.querySelector("#viewTitleSwitcher") as TextLabelElement | null;
    return (row.querySelector("TextLabelElement") as TextLabelElement).getText() + (switcher?.getText() ?? "");
}

describe("ViewTitleRowElement — container switcher", () => {
    it("a chevron follows the title; turning the switcher off removes it", () => {
        const row = new ViewTitleRowElement("EXPLORER", { chevron: false });
        expect(row.hasSwitcher).toBe(false);
        row.setSwitcher(true);
        expect(row.hasSwitcher).toBe(true);
        expect(titleText(layout(row))).toBe(` EXPLORER ${CHEVRON} `);

        row.setSwitcher(false);
        expect(row.hasSwitcher).toBe(false);
        expect(titleText(layout(row))).toBe(" EXPLORER");
    });

    // The Explorer header is the folder name (#898): a long one is clipped, the switcher stays reachable.
    it("a clipped title keeps the chevron, and the chevron is the switcher zone", () => {
        const row = new ViewTitleRowElement("A-REALLY-LONG-PROJECT-FOLDER-NAME", { chevron: false });
        row.setSwitcher(true);
        row.setNerdFont(false);
        expect(renderElement(row, 20, 1).screenToString().trimEnd()).toBe(" A-REALLY-LONG ▾  ⋯");
        expect(row.hitZone(15)).toEqual({ kind: "switcher" });
        expect(row.hitZone(18)).toEqual({ kind: "menu" });

        row.setHoveredZone({ kind: "switcher" });
        const chevron = row.querySelector("#viewTitleSwitcher")!;
        expect(chevron.hasStyleState("hover")).toBe(true);
        row.setHoveredZone({ kind: "menu" });
        expect(chevron.hasStyleState("hover")).toBe(false);
    });

    it("the chevron goes after the spinner and survives title and spinner changes", () => {
        const row = new ViewTitleRowElement("SCM", { chevron: false });
        row.setSwitcher(true);
        row.setSpinnerFrame("⠋");
        expect(titleText(layout(row))).toBe(` SCM ⠋ ${CHEVRON} `);
        row.setTitle("SOURCE CONTROL");
        row.setSpinnerFrame(null);
        expect(titleText(layout(row))).toBe(` SOURCE CONTROL ${CHEVRON} `);
    });

    it("the title label is the switcher zone; the filler stays a plain title, ⋯ stays the menu", () => {
        const row = layout(new ViewTitleRowElement("EXPLORER", { chevron: false }));
        expect(row.hitZone(2)).toEqual({ kind: "title" });

        row.setSwitcher(true);
        layout(row);
        // " EXPLORER  " takes columns 0..11.
        expect(row.hitZone(0)).toEqual({ kind: "switcher" });
        expect(row.hitZone(11)).toEqual({ kind: "switcher" });
        expect(row.hitZone(12)).toEqual({ kind: "title" });
        expect(row.hitZone(28)).toEqual({ kind: "menu" });
    });

    it("hovering the switcher zone highlights the title; without a switcher the title has no hover", () => {
        const row = new ViewTitleRowElement("EXPLORER", { chevron: false });
        const bg = (): number => renderElement(row, 30, 1, { themeVars: true }).getBgAt(new Point(2, 0));
        const rest = bg();

        row.setHoveredZone({ kind: "switcher" });
        expect(bg()).toBe(rest);

        row.setSwitcher(true);
        row.setHoveredZone({ kind: "switcher" });
        const hovered = bg();
        expect(hovered).not.toBe(rest);

        row.setHoveredZone({ kind: "title" });
        expect(bg()).toBe(rest);

        row.setHoveredZone({ kind: "switcher" });
        row.setSwitcher(false);
        expect(bg()).toBe(rest);
    });
});
