import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import type { QuickPickItem } from "@tuidom/elements/quickpick/quickPickElement";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputService } from "./quickInputService.ts";

function createService(): {
    service: QuickInputService;
    component: QuickInputComponent;
    body: BodyElement;
    testApp: TestApp;
} {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { service, component, body, testApp };
}

function outsideClick(body: BodyElement): void {
    body.dispatchEvent(
        new TUIMouseEvent("mousedown", { screenX: 0, screenY: 0, localX: 0, localY: 0, button: "left" }),
    );
}

const ITEMS: QuickPickItem[] = [
    { label: "Dark Modern", description: "dark" },
    { label: "Dark+", description: "dark" },
    { label: "Monokai", description: "dark" },
    { label: "Light Modern", description: "light" },
];

describe("QuickInputService.quickPick", () => {
    it("opens a visible overlay", () => {
        const { service, body } = createService();
        void service.quickPick({ items: ITEMS });
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
    });

    it("resolves with the highlighted item on Enter", async () => {
        const { service, testApp } = createService();
        const result = service.quickPick({ items: ITEMS });
        testApp.sendKey("ArrowDown");
        testApp.sendKey("Enter");
        await expect(result).resolves.toMatchObject({ label: "Dark+" });
    });

    it("resolves undefined on Escape", async () => {
        const { service, testApp } = createService();
        const result = service.quickPick({ items: ITEMS });
        testApp.sendKey("Escape");
        await expect(result).resolves.toBeUndefined();
    });

    it("resolves undefined on an outside click", async () => {
        const { service, body } = createService();
        const result = service.quickPick({ items: ITEMS });
        outsideClick(body);
        await expect(result).resolves.toBeUndefined();
    });

    it("pre-highlights the given activeIndex", async () => {
        const { service, testApp } = createService();
        const result = service.quickPick({ items: ITEMS, activeIndex: 2 });
        testApp.sendKey("Enter");
        await expect(result).resolves.toMatchObject({ label: "Monokai" });
    });

    it("fires onDidChangeActive on open and on navigation (live preview)", async () => {
        const { service, testApp } = createService();
        const seen: (string | undefined)[] = [];
        const result = service.quickPick({
            items: ITEMS,
            activeIndex: 0,
            onDidChangeActive: (item) => seen.push(item?.label),
        });

        // Fired once for the initial active item...
        expect(seen).toEqual(["Dark Modern"]);
        // ...then again for each navigation step.
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        expect(seen).toEqual(["Dark Modern", "Dark+", "Monokai"]);

        testApp.sendKey("Escape");
        await result;
    });

    it("filters items live by label substring", async () => {
        const { service, component, testApp } = createService();
        const result = service.quickPick({ items: ITEMS });
        // Type "light" → only "Light Modern" remains; it becomes the active item.
        for (const ch of "light") testApp.sendKey(ch);
        expect(component.view.items.map((i) => i.label)).toEqual(["Light Modern"]);
        testApp.sendKey("Enter");
        await expect(result).resolves.toMatchObject({ label: "Light Modern" });
    });

    it("restores the full list when the query is cleared", () => {
        const { service, component, testApp } = createService();
        void service.quickPick({ items: ITEMS });
        for (const ch of "light") testApp.sendKey(ch);
        expect(component.view.items).toHaveLength(1);

        // Backspace the query empty again → the empty-needle branch returns every item.
        for (const _ch of "light") testApp.sendKey("Backspace");
        expect(component.view.items.map((i) => i.label)).toEqual(ITEMS.map((i) => i.label));
    });

    it("reports undefined active item when the filter matches nothing", () => {
        const { service, component, testApp } = createService();
        const seen: (string | undefined)[] = [];
        void service.quickPick({ items: ITEMS, onDidChangeActive: (item) => seen.push(item?.label) });
        for (const ch of "zzz") testApp.sendKey(ch);
        expect(component.view.items).toHaveLength(0);
        expect(seen.at(-1)).toBeUndefined();
    });

    it("supersedes a previous open pick (resolves it undefined)", async () => {
        const { service, testApp } = createService();
        const first = service.quickPick({ items: ITEMS });
        const second = service.quickPick({ items: ITEMS });
        await expect(first).resolves.toBeUndefined();
        testApp.sendKey("Enter");
        await expect(second).resolves.toMatchObject({ label: "Dark Modern" });
    });
});
