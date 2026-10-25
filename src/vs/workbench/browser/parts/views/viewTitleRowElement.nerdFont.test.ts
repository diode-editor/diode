import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { PaneViewElement } from "./paneViewElement.ts";
import { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";
import { ViewTitleRowElement } from "./viewTitleRowElement.ts";

const NERD_EXPANDED = "";
const NERD_COLLAPSED = "";

function titleText(element: TUIElement): string {
    return (element.querySelector("TextLabelElement") as TextLabelElement).getText();
}

function paneHeader(view: PaneViewElement, id: string): TUIElement {
    const header = view.querySelector(`#paneHeader-${id}`);
    if (header === null) throw new Error(`no header of pane "${id}"`);
    return header;
}

function addPane(view: PaneViewElement, id: string): void {
    view.addPane({ id, title: id.toUpperCase(), body: new FillerElement() });
}

describe("diode.icons.nerdFont — view title chevrons", () => {
    it("a title row switches its chevron between Nerd Font and Unicode, in both states", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setNerdFont(false);
        expect(titleText(row)).toBe(" ▾ CHANGES");
        row.setExpanded(false);
        expect(titleText(row)).toBe(" ▸ CHANGES");
        row.setNerdFont(true);
        expect(titleText(row)).toBe(` ${NERD_COLLAPSED} CHANGES`);
    });

    it("setting the same mode again leaves the laid-out row clean", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.layout(BoxConstraints.tight(new Size(30, 1)));
        expect(row.isLayoutDirty).toBe(false);
        row.setNerdFont(true);
        expect(row.isLayoutDirty).toBe(false);
    });

    it("a pane view starts with Nerd Font and hands the mode to existing and later headers", () => {
        const view = new PaneViewElement();
        addPane(view, "a");
        expect(titleText(paneHeader(view, "a"))).toBe(` ${NERD_EXPANDED} A`);

        view.setNerdFont(false);
        addPane(view, "b");
        expect(titleText(paneHeader(view, "a"))).toBe(" ▾ A");
        expect(titleText(paneHeader(view, "b"))).toBe(" ▾ B");
    });

    it("a container header passes the mode to its switcher chevron", () => {
        const header = new ViewContainerHeaderElement("EXPLORER");
        header.setSwitcher(true);
        expect(titleText(header)).toContain(NERD_EXPANDED);
        header.setNerdFont(false);
        expect(titleText(header)).toContain("▾");
        expect(titleText(header)).not.toContain(NERD_EXPANDED);
    });
});
