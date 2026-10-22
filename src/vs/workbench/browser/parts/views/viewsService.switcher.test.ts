import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it } from "vitest";

import type { PaneHeaderElement } from "./paneHeaderElement.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

function harness() {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "explorer", title: "EXPLORER", location: "sidebar", order: 0, isDefault: true });
    h.service.registerView(testView("explorer.files", "explorer", 0));
    h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar", order: 2 });
    h.service.registerView(testView("scm.changes", "scm", 0));
    h.service.registerView(testView("scm.graph", "scm", 1));
    h.service.registerContainer({ id: "terminal", title: "TERMINAL", location: "panel", order: 0 });
    h.service.registerView(testView("terminal.view", "terminal", 0));
    h.service.attachRegisteredContainers();
    return h;
}

function labels(entries: readonly unknown[]): string[] {
    return (entries as MenuItemEntry[]).map((entry) => `${entry.icon ?? ""}${entry.label}`);
}

describe("ViewsService — container switcher on the sidebar title", () => {
    it("a merged sidebar section's header carries it and lists the sidebar containers", () => {
        const h = harness();
        const header = h.paneView("explorer").querySelector("#paneHeader-explorer-files") as PaneHeaderElement;
        header.onSwitch?.({ screenX: 0, screenY: 1 });

        const delegate = h.shown.at(-1);
        expect(delegate?.getOwner()).toBe(h.paneView("explorer"));
        expect(delegate?.getAnchor()).toEqual({ screenX: 0, screenY: 1 });
        expect(labels(delegate?.getEntries?.() ?? [])).toEqual(["●Explorer", " Source Control"]);
    });

    it("a container of several sections has it on its own header; picking a container opens it with focus", () => {
        const h = harness();
        h.showViewlet("scm");
        const header = h.header("scm");
        expect(header?.inspectState()).toMatchObject({ title: "SOURCE CONTROL" });
        header?.onSwitch?.({ screenX: 0, screenY: 1 });

        const delegate = h.shown.at(-1);
        expect(delegate?.getOwner()).toBe(header);
        const entries = (delegate?.getEntries?.() ?? []) as MenuItemEntry[];
        expect(labels(entries)).toEqual([" Explorer", "●Source Control"]);
        entries[0].onSelect?.();
        expect(h.shownViewlets.at(-1)).toEqual({ id: "explorer", reveal: true });
    });

    it("a container moved to the panel leaves the list and its tab strip gets no switcher", () => {
        const h = harness();
        h.service.moveViewContainerToLocation("scm", "panel");
        // The strip is computed for the active tab.
        h.service.openViewContainer("scm");
        const strip = h.header("scm");
        expect(strip).not.toBeNull();
        const before = h.shown.length;
        strip?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        expect(h.shown.length).toBe(before);

        const header = h.paneView("explorer").querySelector("#paneHeader-explorer-files") as PaneHeaderElement;
        header.onSwitch?.({ screenX: 0, screenY: 1 });
        expect(labels(h.shown.at(-1)?.getEntries?.() ?? [])).toEqual(["●Explorer"]);
    });

    it("a section that stops being merged hands the switcher to the container header", () => {
        const h = harness();
        h.service.registerView(testView("explorer.outline", "explorer", 1));
        const section = h.paneView("explorer").querySelector("#paneHeader-explorer-files") as PaneHeaderElement;
        const sectionShown = h.shown.length;
        section.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        // Enter on a collapsible section toggles it, the switcher stays on the container header.
        expect(h.shown.length).toBe(sectionShown);
        h.header("explorer")?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        expect(h.shown.length).toBe(sectionShown + 1);
    });
});
