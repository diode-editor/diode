import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFill, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { VFlexElement, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { PaneHeaderElement } from "./paneHeaderElement.ts";
import { PaneViewElement } from "./paneViewElement.ts";
import { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";

type Header = ViewContainerHeaderElement | PaneHeaderElement;

function click(header: Header, localX: number): void {
    for (const type of ["mousedown", "mouseup"] as const) {
        header.dispatchEvent(
            new TUIMouseEvent(type, { button: "left", screenX: localX, screenY: 0, localX, localY: 0 }),
        );
    }
}

function key(header: Header, name: string): boolean {
    const event = new TUIKeyboardEvent("keydown", { key: name });
    header.dispatchEvent(event);
    return event.defaultPrevented;
}

/** Placed at (4, 2) on screen: the anchor is the header's global position, not the click point. */
function placed<T extends Header>(header: T): T {
    const row = new HFlexElement();
    row.addChild(new FillerElement(), { width: hflexFixed(4), height: 1 });
    row.addChild(header, { width: hflexFill(), height: 1 });
    const column = new VFlexElement();
    column.addChild(new FillerElement(), { height: vflexFixed(2), width: "fill" });
    column.addChild(row, { height: vflexFixed(1), width: "fill" });
    TestApp.createWithContent(column, new Size(34, 3)).render();
    return header;
}

describe("ViewContainerHeaderElement — container switcher", () => {
    it("a click on the title opens the switcher under the header's left edge", () => {
        const header = new ViewContainerHeaderElement("SOURCE CONTROL");
        header.setSwitcher(true);
        const onSwitch = vi.fn();
        header.onSwitch = onSwitch;
        placed(header);

        click(header, 3);
        expect(onSwitch).toHaveBeenCalledWith({ screenX: 4, screenY: 2 });
    });

    it("Enter and Space open it from the keyboard; other keys and a header without a switcher do nothing", () => {
        const header = new ViewContainerHeaderElement("SOURCE CONTROL");
        const onSwitch = vi.fn();
        header.onSwitch = onSwitch;
        header.layout(BoxConstraints.tight(new Size(30, 1)));

        expect(key(header, "Enter")).toBe(false);
        expect(onSwitch).not.toHaveBeenCalled();

        header.setSwitcher(true);
        expect(key(header, "a")).toBe(false);
        expect(onSwitch).not.toHaveBeenCalled();
        expect(key(header, "Enter")).toBe(true);
        expect(key(header, " ")).toBe(true);
        expect(onSwitch).toHaveBeenCalledTimes(2);

        header.dispatchEvent(new TUIKeyboardEvent("keyup", { key: "Enter" }));
        expect(onSwitch).toHaveBeenCalledTimes(2);
    });
});

describe("container switcher — without a switcher or a listener", () => {
    it("a click on the title of a header without a switcher does not call onSwitch", () => {
        for (const header of [
            new ViewContainerHeaderElement("SCM"),
            new PaneHeaderElement("EXPLORER", { collapsible: false }),
        ]) {
            const onSwitch = vi.fn();
            header.onSwitch = onSwitch;
            placed(header);
            click(header, 2);
            expect(onSwitch).not.toHaveBeenCalled();
        }
    });

    it("a switcher with nobody listening does nothing and does not throw", () => {
        const container = new ViewContainerHeaderElement("SCM");
        const pane = new PaneHeaderElement("EXPLORER", { collapsible: false });
        for (const header of [container, pane]) {
            header.setSwitcher(true);
            placed(header);
            expect(() => {
                click(header, 2);
                key(header, "Enter");
            }).not.toThrow();
        }
        const paneView = new PaneViewElement();
        paneView.addPane({ id: "p", title: "P", body: new PaneViewElement(), collapsible: false, switcher: true });
        TestApp.createWithContent(paneView, new Size(30, 5)).render();
        expect(() => key(paneView.querySelector("#paneHeader-p") as PaneHeaderElement, "Enter")).not.toThrow();
    });
});

describe("PaneHeaderElement — container switcher (merged section)", () => {
    it("a click on the title opens the switcher instead of collapsing", () => {
        const header = new PaneHeaderElement("EXPLORER", { collapsible: false });
        header.setSwitcher(true);
        const onSwitch = vi.fn();
        const onToggle = vi.fn();
        header.onSwitch = onSwitch;
        header.onToggle = onToggle;
        placed(header);

        click(header, 3);
        expect(onSwitch).toHaveBeenCalledWith({ screenX: 4, screenY: 2 });
        expect(onToggle).not.toHaveBeenCalled();
    });

    it("Enter opens the switcher of a merged section; without one Enter does nothing", () => {
        const header = new PaneHeaderElement("EXPLORER", { collapsible: false });
        const onSwitch = vi.fn();
        header.onSwitch = onSwitch;
        header.layout(BoxConstraints.tight(new Size(30, 1)));

        key(header, "Enter");
        expect(onSwitch).not.toHaveBeenCalled();

        header.setSwitcher(true);
        key(header, "Enter");
        expect(onSwitch).toHaveBeenCalledOnce();
    });
});

describe("PaneViewElement — container switcher", () => {
    it("`switcher` puts it on the section header and forwards the request", () => {
        const paneView = new PaneViewElement();
        const requests: unknown[] = [];
        paneView.onDidRequestSwitcher = (anchor) => requests.push(anchor);
        paneView.addPane({
            id: "explorer.view",
            title: "EXPLORER",
            body: new PaneViewElement(),
            collapsible: false,
            switcher: true,
        });
        paneView.addPane({ id: "other", title: "OTHER", body: new PaneViewElement() });
        const app = TestApp.createWithContent(paneView, new Size(30, 10));
        app.render();

        const switching = paneView.querySelector("#paneHeader-explorer-view") as PaneHeaderElement;
        const plain = paneView.querySelector("#paneHeader-other") as PaneHeaderElement;
        key(plain, "Enter");
        expect(requests).toEqual([]);
        key(switching, "Enter");
        expect(requests).toEqual([{ screenX: 0, screenY: 0 }]);
    });
});
