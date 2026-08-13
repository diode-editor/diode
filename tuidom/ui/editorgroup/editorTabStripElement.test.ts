import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../testing/renderElement.ts";
import type { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Point } from "../../common/geometryPromitives.ts";

import type { TabInfo } from "./editorTabStripElement.ts";
import { EditorTabStripElement } from "./editorTabStripElement.ts";

// Тестовая фикстура иконок: виджету всё равно, откуда глиф и цвет — реестр
// файловых иконок принадлежит приложению. Значения .ts/.js — дословно из него.
const tsIcon = { icon: "\uE628", color: packRgb(49, 120, 198) };
const jsIcon = { icon: "\uE781", color: packRgb(241, 224, 90) };

function makeTabs(...names: string[]): TabInfo[] {
    return names.map((name) => {
        const fi = name.endsWith(".js") ? jsIcon : tsIcon;
        return { label: name, icon: fi.icon, iconColor: fi.color, isModified: false, isReadOnly: false };
    });
}

function renderStrip(strip: EditorTabStripElement, width: number): { backend: MockTerminalBackend; text: string } {
    const backend = renderElement(strip, width, 1);
    const text = backend.getTextAt(new Point(0, 0), width);
    return { backend, text };
}

describe("EditorTabStripElement", () => {
    describe("basic rendering", () => {
        it("renders empty strip as filler", () => {
            const strip = new EditorTabStripElement();
            const { text } = renderStrip(strip, 20);
            expect(text.trim()).toBe("");
        });

        it("renders single tab with label", () => {
            const strip = new EditorTabStripElement();
            strip.setTabs(makeTabs("file.ts"));
            strip.activeIndex = 0;
            const { text } = renderStrip(strip, 40);
            expect(text).toContain("file.ts");
        });

        it("renders multiple tabs horizontally", () => {
            const strip = new EditorTabStripElement();
            strip.setTabs(makeTabs("file.ts", "app.js"));
            strip.activeIndex = 0;
            const { text } = renderStrip(strip, 60);
            expect(text).toContain("file.ts");
            expect(text).toContain("app.js");
        });

        it("filler fills remaining space", () => {
            const strip = new EditorTabStripElement();
            strip.setTabs(makeTabs("a.ts"));
            strip.activeIndex = 0;
            const { text } = renderStrip(strip, 40);
            // All characters should be filled (no nulls)
            expect(text.length).toBe(40);
        });
    });

    describe("active index", () => {
        it("активная вкладка — состояние active (когда-вариант токенов)", () => {
            const strip = new EditorTabStripElement();
            strip.setTabs(makeTabs("a.ts", "b.ts"));
            strip.activeIndex = 0;

            const items = strip.getItemElements();
            expect(items[0].hasStyleState("active")).toBe(true);
            expect(items[1].hasStyleState("active")).toBe(false);
            expect(items[0].style.bg).toBe("tab.inactiveBackground");
            expect(items[0].style.when?.[0].bg).toBe("tab.activeBackground");
        });

        it("смена activeIndex переносит состояние active", () => {
            const strip = new EditorTabStripElement();
            strip.setTabs(makeTabs("a.ts", "b.ts"));
            strip.activeIndex = 0;

            strip.activeIndex = 1;

            const items = strip.getItemElements();
            expect(items[0].hasStyleState("active")).toBe(false);
            expect(items[1].hasStyleState("active")).toBe(true);
        });
    });

    describe("callbacks", () => {
        it("onTabActivate fires with correct index on tab click", () => {
            const strip = new EditorTabStripElement();
            const onActivate = vi.fn();
            strip.onTabActivate = onActivate;
            strip.setTabs(makeTabs("a.ts", "b.ts"));
            strip.activeIndex = 0;

            // Simulate onActivate callback from the second tab item
            const items = strip.getItemElements();
            items[1].onActivate?.();

            expect(onActivate).toHaveBeenCalledWith(1);
        });

        it("onTabClose fires with correct index on close click", () => {
            const strip = new EditorTabStripElement();
            const onClose = vi.fn();
            strip.onTabClose = onClose;
            strip.setTabs(makeTabs("a.ts", "b.ts"));
            strip.activeIndex = 0;

            const items = strip.getItemElements();
            items[0].onClose?.();

            expect(onClose).toHaveBeenCalledWith(0);
        });
    });

    describe("setTabs update", () => {
        it("updates existing tabs in place", () => {
            const strip = new EditorTabStripElement();
            strip.setTabs(makeTabs("a.ts", "b.ts"));

            const itemsBefore = strip.getItemElements();
            const firstItem = itemsBefore[0];

            strip.setTabs(makeTabs("c.ts", "d.ts"));

            const itemsAfter = strip.getItemElements();
            expect(itemsAfter[0]).toBe(firstItem);
            expect(itemsAfter[0].getLabel()).toBe("c.ts");
        });

        it("modified indicator updates through setTabs", () => {
            const strip = new EditorTabStripElement();
            const tabs = makeTabs("a.ts");
            strip.setTabs(tabs);

            const items = strip.getItemElements();
            expect(items[0].getModified()).toBe(false);

            tabs[0].isModified = true;
            strip.setTabs(tabs);
            expect(items[0].getModified()).toBe(true);
        });

        it("tabs created with paddingLeft=2 and paddingRight=2", () => {
            const strip = new EditorTabStripElement();
            strip.setTabs(makeTabs("file.ts"));

            const items = strip.getItemElements();
            expect(items[0].getPaddingLeft()).toBe(2);
            expect(items[0].getPaddingRight()).toBe(2);
        });

        it("tab getMinIntrinsicWidth reflects padding=2", () => {
            const strip = new EditorTabStripElement();
            strip.setTabs(makeTabs("file.ts"));

            const items = strip.getItemElements();
            // [2 pad][icon][space][file.ts][ ×][2 pad] = 2 + 1 + 1 + 7 + 2 + 2 = 15
            expect(items[0].getMinIntrinsicWidth(1)).toBe(15);
        });
    });

    describe("intrinsic size", () => {
        it("height is always 1", () => {
            const strip = new EditorTabStripElement();
            expect(strip.getMinIntrinsicHeight(100)).toBe(1);
            expect(strip.getMaxIntrinsicHeight(100)).toBe(1);
        });

        it("width delegates to the inner hflex (filler contributes zero width)", () => {
            const empty = new EditorTabStripElement();
            // With only the fill filler, intrinsic width collapses to 0.
            expect(empty.getMinIntrinsicWidth(1)).toBe(0);
            expect(empty.getMaxIntrinsicWidth(1)).toBe(0);
        });

        it("intrinsic width grows by the sum of the tab item widths", () => {
            const strip = new EditorTabStripElement();
            strip.setTabs(makeTabs("a.ts", "b.ts"));

            const items = strip.getItemElements();
            const expected = items[0].getMaxIntrinsicWidth(1) + items[1].getMaxIntrinsicWidth(1);

            expect(strip.getMaxIntrinsicWidth(1)).toBe(expected);
            expect(strip.getMinIntrinsicWidth(1)).toBe(expected);
        });

        it("min and max intrinsic width agree and equal the fit tab widths", () => {
            const strip = new EditorTabStripElement();
            strip.setTabs(makeTabs("a.ts", "b.ts", "c.ts"));

            const items = strip.getItemElements();
            const sum =
                items[0].getMaxIntrinsicWidth(1) + items[1].getMaxIntrinsicWidth(1) + items[2].getMaxIntrinsicWidth(1);

            // Strip width delegates to the inner hflex; the fill filler adds 0.
            expect(strip.getMinIntrinsicWidth(1)).toBe(sum);
            expect(strip.getMaxIntrinsicWidth(1)).toBe(sum);
        });

        it("renders the filler across the remaining width after the tabs", () => {
            const strip = new EditorTabStripElement();
            strip.setTabs(makeTabs("a.ts"));
            strip.activeIndex = 0;

            const items = strip.getItemElements();
            const tabWidth = items[0].getMaxIntrinsicWidth(1);

            const { text } = renderStrip(strip, 30);
            // Everything past the single tab is filler spaces.
            expect(text.length).toBe(30);
            expect(text.slice(tabWidth)).toBe(" ".repeat(30 - tabWidth));
        });
    });
});
