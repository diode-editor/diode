import { BoxConstraints, Offset, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IPaneCompositeTabContextMenuRequest } from "../paneCompositePartService.ts";

import { PanelComponent } from "./panelComponent.ts";
import { PanelContainerElement } from "./panelContainerElement.ts";
import { PanelService } from "./panelService.ts";

describe("PanelComponent — tabs leave and come back", () => {
    it("a tab removed from the registry leaves the tab row", () => {
        const service = new PanelService();
        const component = new PanelComponent(service, new CommandRegistry());
        service.addView({ id: "a", title: "A" });
        service.addView({ id: "b", title: "B" });
        service.removeView("a");
        expect(component.view.getViewIds()).toEqual(["b"]);
        expect(component.view.getActiveViewId()).toBe("b");
    });

    it("a returning tab takes its registry position, not the end", () => {
        const service = new PanelService();
        const component = new PanelComponent(service, new CommandRegistry());
        service.addView({ id: "a", title: "A" });
        service.addView({ id: "b", title: "B" });
        service.removeView("a");
        service.addView({ id: "a", title: "A", index: 0 });
        expect(component.view.getViewIds()).toEqual(["a", "b"]);
    });

    it("control: removing the active tab activates the first remaining one, removing an inactive one changes nothing", () => {
        const view = new PanelContainerElement();
        for (const id of ["a", "b", "c"]) view.addView({ id, title: id, content: null });
        view.setActiveView("b");
        view.removeView("c");
        expect(view.getActiveViewId()).toBe("b");
        view.removeView("b");
        expect(view.getActiveViewId()).toBe("a");
        view.removeView("a");
        expect(view.getActiveViewId()).toBeNull();
        expect(view.getViewIds()).toEqual([]);
    });

    it("removing a tab unknown to the control — no-op", () => {
        const view = new PanelContainerElement();
        for (const id of ["a", "b"]) view.addView({ id, title: id, content: null });
        view.removeView("ghost");
        expect(view.getViewIds()).toEqual(["a", "b"]);
    });

    it("the removed tab's content leaves the tree, the new active tab's content is shown", () => {
        const view = new PanelContainerElement();
        const a = new TUIElement();
        const b = new TUIElement();
        view.addView({ id: "a", title: "A", content: a });
        view.addView({ id: "b", title: "B", content: b });
        view.removeView("a");
        expect(view.getChildren()).toEqual([b]);
        expect(b.hidden).toBe(false);
    });
});

describe("PanelComponent — tab context menu", () => {
    function scene() {
        const service = new PanelService();
        const component = new PanelComponent(service, new CommandRegistry());
        service.addView({ id: "problems", title: "PROBLEMS" });
        service.addView({ id: "output", title: "OUTPUT" });
        const requests: IPaneCompositeTabContextMenuRequest[] = [];
        service.onDidRequestTabContextMenu((request) => requests.push(request));
        // Panel at an offset: screen coordinates ≠ local ones.
        component.view.localPosition = new Offset(5, 3);
        component.view.layout(BoxConstraints.tight(new Size(40, 8)));
        const menu = (trigger: "mouse" | "keyboard", screenX: number, screenY: number): boolean => {
            const event = new TUIContextMenuEvent({
                trigger,
                button: trigger === "mouse" ? "right" : "none",
                screenX,
                screenY,
                localX: screenX - 5,
                localY: screenY - 3,
            });
            component.view.dispatchEvent(event);
            return event.defaultPrevented;
        };
        return { component, requests, menu };
    }

    it("a right click on a tab requests a menu with its id, the click point and the owning panel", () => {
        const { component, requests, menu } = scene();
        // The panel tab row is its row 1; OUTPUT occupies panel columns 11..18.
        expect(menu("mouse", 5 + 13, 3 + 1)).toBe(true);
        expect(requests).toEqual([{ id: "output", anchor: { screenX: 18, screenY: 4 }, owner: component.view }]);
        expect(component.view.getActiveViewId()).toBe("problems");
    });

    it("Shift+F10 — the active tab's menu below its start", () => {
        const { component, requests, menu } = scene();
        menu("keyboard", 0, 0);
        expect(requests).toEqual([
            { id: "problems", anchor: { screenX: 5 + 1, screenY: 3 + 2 }, owner: component.view },
        ]);
    });

    it("column hit test: a tab spans from the first column of its segment to the last", () => {
        const { requests, menu } = scene();
        let map = "";
        for (let x = 0; x < 24; x++) {
            requests.length = 0;
            menu("mouse", 5 + x, 3 + 1);
            map += requests.at(0)?.id.charAt(0) ?? ".";
        }
        // PROBLEMS is columns 1..10 (with tab padding), OUTPUT is 11..18.
        expect(map).toBe(".ppppppppppoooooooo.....");
    });

    it("Shift+F10 — the menu of the active tab specifically, not the first one", () => {
        const { component, requests, menu } = scene();
        component.view.setActiveView("output");
        menu("keyboard", 0, 0);
        expect(requests).toEqual([
            { id: "output", anchor: { screenX: 5 + 11, screenY: 3 + 2 }, owner: component.view },
        ]);
    });

    it("without a tab menu subscriber — the event is consumed without an error", () => {
        const view = new PanelContainerElement();
        view.addView({ id: "a", title: "A", content: null });
        view.layout(BoxConstraints.tight(new Size(20, 4)));
        const event = new TUIContextMenuEvent({
            trigger: "keyboard",
            button: "none",
            screenX: 0,
            screenY: 0,
            localX: 0,
            localY: 0,
        });
        view.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it("off the tabs and outside the tab row requests no menu and does not consume the event", () => {
        const { requests, menu } = scene();
        expect(menu("mouse", 5 + 30, 3 + 1)).toBe(false);
        expect(menu("mouse", 5 + 13, 3 + 4)).toBe(false);
        expect(menu("mouse", 5 + 13, 3)).toBe(false);
        expect(requests).toEqual([]);
    });

    it("an event bubbled up from tab content is not a tab menu", () => {
        const service = new PanelService();
        const component = new PanelComponent(service, new CommandRegistry());
        const content = new TUIElement();
        service.addView({ id: "problems", title: "PROBLEMS", content });
        const requests: IPaneCompositeTabContextMenuRequest[] = [];
        service.onDidRequestTabContextMenu((request) => requests.push(request));
        component.view.layout(BoxConstraints.tight(new Size(40, 8)));
        content.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "keyboard",
                button: "none",
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
            }),
        );
        expect(requests).toEqual([]);
    });
});
