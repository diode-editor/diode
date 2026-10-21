import { compositeOver } from "@tuidom/core/common/colorUtils";
import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

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

describe("ViewTitleRowElement — title", () => {
    it("the chevron reflects collapsed state", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} CHANGES`);
        row.setExpanded(false);
        expect(titleText(row)).toBe(` ${CHEVRON_COLLAPSED} CHANGES`);
    });

    it("without a chevron: only indent and title", () => {
        const row = layout(new ViewTitleRowElement("SOURCE CONTROL", { chevron: false }));
        expect(titleText(row)).toBe(" SOURCE CONTROL");
        // No chevron: collapsed state isn't drawn, but it doesn't break the row either.
        row.setExpanded(false);
        expect(titleText(row)).toBe(" SOURCE CONTROL");
    });

    it("setTitle changes the label, repeating the same one is a no-op", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        row.setTitle("GRAPH");
        expect(row.getTitle()).toBe("GRAPH");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} GRAPH`);
        row.setTitle("GRAPH");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} GRAPH`);
    });

    it("setExpanded to the same state is a no-op", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        row.setExpanded(true);
        expect(row.isExpanded).toBe(true);
    });
});

describe("ViewTitleRowElement — button zones", () => {
    it("title, buttons and ⋯ are laid out in zones right to left", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.collapse", icon: "C" },
        ]);
        layout(row);

        // Width 30: ⋯ takes 27..29, a separator at 26 before it, a button at
        // 23..25, another separator at 22 and a button at 19..21.
        expect(row.hitZone(28)).toEqual({ kind: "menu" });
        expect(row.hitZone(24)).toEqual({ kind: "action", actionId: "cmd.collapse" });
        expect(row.hitZone(20)).toEqual({ kind: "action", actionId: "cmd.refresh" });
        // A separator is not a button: a click on it goes to the title.
        expect(row.hitZone(26)).toEqual({ kind: "title" });
        expect(row.hitZone(2)).toEqual({ kind: "title" });
        expect(row.menuAnchorX).toBe(27);
    });

    it("a narrow header clips buttons: collapsed ones have no zone", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row, 4);
        expect(row.hitZone(3)).toEqual({ kind: "title" });
    });

    it("a single button is rebuilt when any of its fields changes", () => {
        // Specifically with a single button: with two, a weakened comparison hides behind
        // the neighbor, which yields "sets differ" anyway.
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row);
        expect(row.hitZone(24)).toEqual({ kind: "action", actionId: "cmd.refresh" });

        row.setActions([{ id: "cmd.reload", icon: "R" }]);
        layout(row);
        expect(row.hitZone(24)).toEqual({ kind: "action", actionId: "cmd.reload" });

        row.setActions([{ id: "cmd.reload", icon: "X" }]);
        layout(row);
        expect(renderElement(row, 30, 1, { themeVars: true }).screenToString()).toContain("X");
    });

    it("rebuilds buttons when any field of any of them changes", () => {
        // The early return in setActions compares the set element by element: a missed
        // difference means a button stuck in its previous state.
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.collapse", icon: "C" },
        ]);
        layout(row);

        // The second button's id changed, so clicking it must run the new command.
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.expand", icon: "C" },
        ]);
        layout(row);
        expect(row.hitZone(24)).toEqual({ kind: "action", actionId: "cmd.expand" });

        // The second button's icon changed, so the new glyph must be on screen.
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.expand", icon: "E" },
        ]);
        layout(row);
        expect(renderElement(row, 30, 1, { themeVars: true }).screenToString()).toContain("E");
    });

    it("setActions with the same set is a no-op, with another it rebuilds zones", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row);
        expect(row.hitZone(24)).toEqual({ kind: "action", actionId: "cmd.refresh" });

        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row);
        expect(row.hitZone(24)).toEqual({ kind: "action", actionId: "cmd.refresh" });

        row.setActions([]);
        layout(row);
        expect(row.hitZone(24)).toEqual({ kind: "title" });
        expect(row.hitZone(28)).toEqual({ kind: "menu" });
    });
});

describe("ViewTitleRowElement — hidden ⋯ button", () => {
    it("setMenuVisible(false) removes the button and its zone, true restores them", () => {
        const row = new ViewTitleRowElement("OUTPUT", { chevron: false });
        row.setActions([{ id: "cmd.clear", icon: "C" }]);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "menu" });

        row.setMenuVisible(false);
        layout(row);
        // Only one button is left: it moved to the right edge and there is no separator anymore.
        expect(row.hitZone(28)).toEqual({ kind: "action", actionId: "cmd.clear" });
        row.setMenuVisible(false);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "action", actionId: "cmd.clear" });

        // The columns where "⋯" was before hiding no longer open the menu on click.
        row.setActions([]);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "title" });

        row.setMenuVisible(true);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "menu" });
    });
});

describe("ViewTitleRowElement — hover highlight", () => {
    const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
    // The Dark+ token is semi-transparent (`#5A5D5E50`): the cell holds its blend over
    // the row background, which the engine computes when painting.
    const HOVER_TOKEN = theme.getColor("toolbar.hoverBackground")!;

    /** Column background after rendering the row (the engine doesn't set hover on labels itself). */
    function bgAt(row: ViewTitleRowElement, x: number): number {
        return renderElement(row, 30, 1, { themeVars: true }).getBgAt(new Point(x, 0));
    }

    it("exactly the button under the pointer is highlighted", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.collapse", icon: "C" },
        ]);
        layout(row);
        const restBg = bgAt(row, 20);
        const HOVER_BG = compositeOver(HOVER_TOKEN, restBg);
        expect(restBg).not.toBe(HOVER_BG);

        row.setHoveredZone(row.hitZone(20));
        expect(bgAt(row, 20)).toBe(HOVER_BG);
        expect(bgAt(row, 24)).toBe(restBg);
        expect(bgAt(row, 22)).toBe(restBg);

        row.setHoveredZone(row.hitZone(28));
        expect(bgAt(row, 28)).toBe(HOVER_BG);
        expect(bgAt(row, 20)).toBe(restBg);

        row.setHoveredZone(row.hitZone(2));
        expect(bgAt(row, 28)).toBe(restBg);

        row.setHoveredZone(null);
        expect(bgAt(row, 28)).toBe(restBg);
    });
});

describe("ViewTitleRowElement — disabled button", () => {
    const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
    const DISABLED_FG = theme.getColor("disabledForeground")!;
    const ENABLED_FG = theme.getColor("descriptionForeground")!;
    const HOVER_TOKEN = theme.getColor("toolbar.hoverBackground")!;

    function render(row: ViewTitleRowElement): ReturnType<typeof renderElement> {
        return renderElement(row, 30, 1, { themeVars: true });
    }

    it("renders dimmed, an enabled one renders normally", () => {
        const row = new ViewTitleRowElement("GRAPH");
        row.setActions([{ id: "cmd.refresh", icon: "R", enabled: false }]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(DISABLED_FG);

        row.setActions([{ id: "cmd.refresh", icon: "R", enabled: true }]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(ENABLED_FG);
    });

    it("a change of enablement alone rebuilds buttons", () => {
        // Regression for sameActions: the early return in setActions must not swallow
        // an enabled change, otherwise the button stays in its initial state forever.
        const row = new ViewTitleRowElement("GRAPH");
        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(ENABLED_FG);

        row.setActions([{ id: "cmd.refresh", icon: "R", enabled: false }]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(DISABLED_FG);

        row.setActions([{ id: "cmd.refresh", icon: "R", enabled: true }]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(ENABLED_FG);
    });

    it("exactly the button that became disabled dims", () => {
        // The second button in the row: the element-wise comparison must notice a difference
        // beyond the first one.
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.collapse", icon: "C" },
        ]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(ENABLED_FG);

        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.collapse", icon: "C", enabled: false },
        ]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(DISABLED_FG);
        expect(render(row).getFgAt(new Point(20, 0))).toBe(ENABLED_FG);
    });

    it("is not highlighted under the pointer but keeps its zone", () => {
        const row = new ViewTitleRowElement("GRAPH");
        row.setActions([{ id: "cmd.refresh", icon: "R", enabled: false }]);
        layout(row);

        const zone = row.hitZone(24);
        // The zone still belongs to the button: without it the click would fall through to the title and
        // collapse the section.
        expect(zone).toEqual({ kind: "action", actionId: "cmd.refresh" });

        const restBg = render(row).getBgAt(new Point(24, 0));
        row.setHoveredZone(zone);
        expect(render(row).getBgAt(new Point(24, 0))).toBe(restBg);
        expect(render(row).getBgAt(new Point(24, 0))).not.toBe(compositeOver(HOVER_TOKEN, restBg));
    });
});

describe("ViewTitleRowElement — busy spinner", () => {
    it("the frame goes right after the title and is removed again", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        expect(row.isBusy).toBe(false);

        row.setSpinnerFrame("⠋");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} CHANGES ⠋`);
        expect(row.isBusy).toBe(true);

        row.setSpinnerFrame("⠙");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} CHANGES ⠙`);
        row.setSpinnerFrame("⠙");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} CHANGES ⠙`);

        row.setSpinnerFrame(null);
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} CHANGES`);
        expect(row.isBusy).toBe(false);
    });

    it("coexists with the chevron, title changes and collapsed state", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        row.setSpinnerFrame("⠹");
        row.setExpanded(false);
        expect(titleText(row)).toBe(` ${CHEVRON_COLLAPSED} CHANGES ⠹`);
        row.setTitle("GRAPH");
        expect(titleText(row)).toBe(` ${CHEVRON_COLLAPSED} GRAPH ⠹`);
        // The title in the state is raw: the spinner must not leak into e2e assertions.
        expect(row.getTitle()).toBe("GRAPH");
    });

    it("without a chevron the frame still goes after the title", () => {
        const row = layout(new ViewTitleRowElement("SOURCE CONTROL", { chevron: false }));
        row.setSpinnerFrame("⠋");
        expect(titleText(row)).toBe(" SOURCE CONTROL ⠋");
    });

    it("the spinner does not shift button zones", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row);
        const zoneBefore = row.hitZone(28);

        row.setSpinnerFrame("⠋");
        layout(row);
        expect(row.hitZone(28)).toEqual(zoneBefore);
    });

    it("the frame reaches the screen", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setSpinnerFrame("⠋");
        const screen = renderElement(row, 30, 1, { themeVars: true });
        expect(screen.screenToString()).toContain("CHANGES ⠋");
    });
});

describe("ViewTitleRowElement — title widget", () => {
    it("the widget goes between the title and buttons and is removed again", () => {
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
