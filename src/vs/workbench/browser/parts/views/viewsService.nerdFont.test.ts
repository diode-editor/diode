import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { createSwitchableIcons } from "../../../../../TestUtils/switchableIcons.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";

import { type IViewsHarness, makeViewsHarness, testView as view } from "./viewsService.testUtils.ts";

const NERD_EXPANDED = "";

function titleText(element: TUIElement | null): string {
    // The switcher chevron is a label of its own, right after the title.
    const switcher = element?.querySelector("#viewTitleSwitcher") as TextLabelElement | null | undefined;
    const title = (element?.querySelector("TextLabelElement") as TextLabelElement | null)?.getText() ?? "";
    return title + (switcher?.getText() ?? "");
}

function sectionTitle(h: IViewsHarness, containerId: string, viewId: string): string {
    return titleText(h.paneView(containerId).querySelector(`#paneHeader-${viewId.replaceAll(".", "-")}`));
}

/** Two sections, so each one has its own header with a chevron. */
function registerScm(h: IViewsHarness): void {
    h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
    h.service.registerView(view("scm.changes", "scm", 10));
    h.service.registerView(view("scm.graph", "scm", 20));
}

function harness(icons: IProductIconService): IViewsHarness {
    const h = makeViewsHarness([], icons);
    registerScm(h);
    return h;
}

describe("ViewsService — diode.icons.nerdFont", () => {
    it("a container built while off draws Unicode chevrons in its sections and its header", () => {
        const { icons } = createSwitchableIcons(false);
        const h = harness(icons);
        h.service.attachContainer("scm");

        expect(sectionTitle(h, "scm", "scm.changes")).toBe(" ▾ SCM.CHANGES");
        expect(titleText(h.header("scm"))).toContain("▾");
        expect(titleText(h.header("scm"))).not.toContain(NERD_EXPANDED);
    });

    it("a live switch redraws attached containers and skips the ones not built yet", async () => {
        const { icons, set } = createSwitchableIcons(true);
        const h = harness(icons);
        h.service.registerContainer({ id: "explorer", title: "EXPLORER", location: "sidebar" });
        h.service.registerView(view("explorer.files", "explorer", 10));
        h.service.registerView(view("explorer.outline", "explorer", 20));
        h.service.attachContainer("scm");
        expect(sectionTitle(h, "scm", "scm.changes")).toBe(` ${NERD_EXPANDED} SCM.CHANGES`);

        await set(false);
        expect(sectionTitle(h, "scm", "scm.graph")).toBe(" ▾ SCM.GRAPH");
        expect(titleText(h.header("scm"))).toContain("▾");

        // Built after the switch: it takes the current mode, not the one at registration.
        h.service.attachContainer("explorer");
        expect(sectionTitle(h, "explorer", "explorer.files")).toBe(" ▾ EXPLORER.FILES");

        await set(true);
        expect(sectionTitle(h, "scm", "scm.graph")).toBe(` ${NERD_EXPANDED} SCM.GRAPH`);
        expect(sectionTitle(h, "explorer", "explorer.files")).toBe(` ${NERD_EXPANDED} EXPLORER.FILES`);
    });
});
