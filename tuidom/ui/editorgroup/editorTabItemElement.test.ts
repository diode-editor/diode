import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../testing/renderElement.ts";
import type { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";

import { EditorTabItemElement } from "./editorTabItemElement.ts";

const LOCK_CHAR = "\uea75"; // nf-cod-lock, см. editorTabItemElement.ts
// Тестовая фикстура иконок: виджету всё равно, откуда глиф и цвет — реестр
// файловых иконок принадлежит приложению. Значения .ts/.js — дословно из него.
const tsIcon = { icon: "\uE628", color: packRgb(49, 120, 198) };
const jsIcon = { icon: "\uE781", color: packRgb(241, 224, 90) };

function renderTab(tab: EditorTabItemElement, width?: number): { backend: MockTerminalBackend; text: string } {
    const intrinsicWidth = width ?? tab.getMaxIntrinsicWidth(1);
    const backend = renderElement(tab, intrinsicWidth, 1);
    const text = backend.getTextAt(new Point(0, 0), intrinsicWidth);
    return { backend, text };
}

describe("EditorTabItemElement", () => {
    describe("intrinsic size", () => {
        it("calculates width with icon, label, and close button", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            // [1 pad][icon][space][file.ts][ ×][1 pad] = 1 + 1 + 1 + 7 + 2 + 1 = 13
            expect(tab.getMaxIntrinsicWidth(1)).toBe(13);
        });

        it("calculates width with modified indicator (shared trailing slot)", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color, {
                modified: true,
            });
            // The dot replaces the cross in a single trailing slot, so the width
            // matches an unmodified tab:
            // [1 pad][icon][space][file.ts][ ●][1 pad] = 1 + 1 + 1 + 7 + 2 + 1 = 13
            expect(tab.getMaxIntrinsicWidth(1)).toBe(13);
        });

        it("calculates width without icon", () => {
            const tab = new EditorTabItemElement("file.ts", "", packRgb(180, 180, 180));
            // [1 pad][file.ts][ ×][1 pad] = 1 + 7 + 2 + 1 = 11
            expect(tab.getMaxIntrinsicWidth(1)).toBe(11);
        });

        it("calculates width with custom padding", () => {
            const tab = new EditorTabItemElement("a.ts", tsIcon.icon, tsIcon.color, {
                paddingLeft: 2,
                paddingRight: 3,
            });
            // [2 pad][icon][space][a.ts][ ×][3 pad] = 2 + 1 + 1 + 4 + 2 + 3 = 13
            expect(tab.getMaxIntrinsicWidth(1)).toBe(13);
        });

        it("calculates width with padding=2 on each side", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color, {
                paddingLeft: 2,
                paddingRight: 2,
            });
            // [2 pad][icon][space][file.ts][ ×][2 pad] = 2 + 1 + 1 + 7 + 2 + 2 = 15
            expect(tab.getMinIntrinsicWidth(1)).toBe(15);
            expect(tab.getMaxIntrinsicWidth(1)).toBe(15);
        });

        it("height is always 1", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            expect(tab.getMinIntrinsicHeight(100)).toBe(1);
            expect(tab.getMaxIntrinsicHeight(100)).toBe(1);
        });
    });

    describe("rendering", () => {
        it("renders tab with icon, label, and close button", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            const { text } = renderTab(tab);
            expect(text).toContain(tsIcon.icon);
            expect(text).toContain("file.ts");
            expect(text).toContain("\u00D7");
        });

        it("renders the modified dot instead of the close cross when modified", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color, {
                modified: true,
            });
            const { text } = renderTab(tab);
            expect(text).toContain("\u25CF"); // \u25CF
            expect(text).not.toContain("\u00D7"); // \u00D7 \u2014 replaced by the dot until hover
        });

        it("does not render modified indicator when not modified", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            const { text } = renderTab(tab);
            expect(text).not.toContain("\u25CF");
        });

        it("renders without icon when icon is empty", () => {
            const tab = new EditorTabItemElement("plain.txt", "", packRgb(180, 180, 180));
            const { text } = renderTab(tab);
            expect(text).toContain("plain.txt");
            expect(text).toContain("\u00D7");
        });

        it("renders padding as spaces", () => {
            const tab = new EditorTabItemElement("f.ts", tsIcon.icon, tsIcon.color, {
                paddingLeft: 2,
                paddingRight: 2,
            });
            const { text } = renderTab(tab);
            expect(text.startsWith("  ")).toBe(true);
            expect(text.endsWith("  ")).toBe(true);
        });
    });

    describe("hover behaviour", () => {
        function hover(tab: EditorTabItemElement, type: "mouseenter" | "mouseleave"): void {
            tab.dispatchEvent(
                new TUIMouseEvent(type, { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 }),
            );
        }

        it("swaps the modified dot for the close cross while hovered", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color, { modified: true });

            expect(renderTab(tab).text).toContain("●"); // ● before hover

            hover(tab, "mouseenter");
            const hovered = renderTab(tab).text;
            expect(hovered).toContain("×"); // × while hovered
            expect(hovered).not.toContain("●");

            hover(tab, "mouseleave");
            expect(renderTab(tab).text).toContain("●"); // ● again after leaving
        });

        it("keeps the close cross on hover for an unmodified tab", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            hover(tab, "mouseenter");
            const { text } = renderTab(tab);
            expect(text).toContain("×");
            expect(text).not.toContain("●");
        });

        it("does not repaint on a repeated mouseenter", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            tab.layout(BoxConstraints.tight(new Size(20, 1)));
            hover(tab, "mouseenter");
            expect(tab.isLayoutDirty).toBe(true);

            tab.layout(BoxConstraints.tight(new Size(20, 1)));
            expect(tab.isLayoutDirty).toBe(false);
            hover(tab, "mouseenter"); // already hovered → no-op
            expect(tab.isLayoutDirty).toBe(false);
        });

        it("does not repaint on a mouseleave when not hovered", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            tab.layout(BoxConstraints.tight(new Size(20, 1)));
            expect(tab.isLayoutDirty).toBe(false);
            hover(tab, "mouseleave"); // never entered → no-op
            expect(tab.isLayoutDirty).toBe(false);
        });
    });

    describe("setters", () => {
        it("setLabel updates label and re-renders", () => {
            const tab = new EditorTabItemElement("old.ts", tsIcon.icon, tsIcon.color);
            tab.setLabel("new.ts");
            expect(tab.getLabel()).toBe("new.ts");
        });

        it("setModified changes modified state", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            expect(tab.getModified()).toBe(false);
            tab.setModified(true);
            expect(tab.getModified()).toBe(true);
        });

        it("setModified with same value does not mark dirty", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            tab.localPosition = new Offset(0, 0);
            tab.layout(BoxConstraints.tight(new Size(20, 1)));
            expect(tab.isLayoutDirty).toBe(false);
            tab.setModified(false);
            expect(tab.isLayoutDirty).toBe(false);
        });

        it("setReadOnly показывает замок и меняет ширину вкладки", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            expect(tab.getReadOnly()).toBe(false);
            const widthBefore = tab.getMaxIntrinsicWidth(1);

            tab.setReadOnly(true);

            expect(tab.getReadOnly()).toBe(true);
            // Замок занимает свою колонку + пробел, поэтому вкладка шире на 2.
            expect(tab.getMaxIntrinsicWidth(1)).toBe(widthBefore + 2);
            expect(renderTab(tab).text).toContain(LOCK_CHAR);
        });

        it("setReadOnly с тем же значением не помечает вкладку грязной", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            tab.localPosition = new Offset(0, 0);
            tab.layout(BoxConstraints.tight(new Size(20, 1)));
            expect(tab.isLayoutDirty).toBe(false);
            tab.setReadOnly(false);
            expect(tab.isLayoutDirty).toBe(false);
        });

        it("замок обрезается вместе с меткой, когда ширины не хватает", () => {
            // Узкая вкладка: пробел после замка уже не влезает — рисуем что успели,
            // а не выходим за границы.
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color, { readOnly: true });
            const { text } = renderTab(tab, 4);
            expect(text).toContain(LOCK_CHAR);
            expect(text).not.toContain("file.ts");
        });

        it("getIcon returns the current icon and setIcon replaces it", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            expect(tab.getIcon()).toBe(tsIcon.icon);

            tab.setIcon(jsIcon.icon, jsIcon.color);
            expect(tab.getIcon()).toBe(jsIcon.icon);

            const { text } = renderTab(tab);
            expect(text).toContain(jsIcon.icon);
            expect(text).not.toContain(tsIcon.icon);
        });

        it("setPaddingLeft changes the left padding and grows the rendered width", () => {
            const tab = new EditorTabItemElement("a.ts", tsIcon.icon, tsIcon.color, {
                paddingLeft: 1,
                paddingRight: 1,
            });
            const before = tab.getMaxIntrinsicWidth(1);
            tab.setPaddingLeft(3);
            expect(tab.getPaddingLeft()).toBe(3);
            expect(tab.getMaxIntrinsicWidth(1)).toBe(before + 2);

            const { text } = renderTab(tab);
            expect(text.startsWith("   ")).toBe(true);
        });

        it("setPaddingRight changes the right padding and grows the rendered width", () => {
            const tab = new EditorTabItemElement("a.ts", tsIcon.icon, tsIcon.color, {
                paddingLeft: 1,
                paddingRight: 1,
            });
            const before = tab.getMaxIntrinsicWidth(1);
            tab.setPaddingRight(3);
            expect(tab.getPaddingRight()).toBe(3);
            expect(tab.getMaxIntrinsicWidth(1)).toBe(before + 2);

            const { text } = renderTab(tab);
            expect(text.endsWith("   ")).toBe(true);
        });
    });

    describe("click handling", () => {
        it("click on main area calls onActivate", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            const onActivate = vi.fn();
            tab.onActivate = onActivate;

            tab.localPosition = new Offset(0, 0);
            tab.layout(BoxConstraints.tight(new Size(tab.getMaxIntrinsicWidth(1), 1)));

            const event = new TUIMouseEvent("click", {
                button: "left",
                screenX: 3,
                screenY: 0,
                localX: 3,
                localY: 0,
            });
            tab.dispatchEvent(event);

            expect(onActivate).toHaveBeenCalledOnce();
        });

        it("click on close button calls onClose", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            const onClose = vi.fn();
            const onActivate = vi.fn();
            tab.onClose = onClose;
            tab.onActivate = onActivate;

            const w = tab.getMaxIntrinsicWidth(1);
            tab.localPosition = new Offset(0, 0);
            tab.layout(BoxConstraints.tight(new Size(w, 1)));

            // Close button is at position: width - paddingRight - 1
            const closeX = w - 1 - 1; // paddingRight=1, close char len=1
            const event = new TUIMouseEvent("click", {
                button: "left",
                screenX: closeX,
                screenY: 0,
                localX: closeX,
                localY: 0,
            });
            tab.dispatchEvent(event);

            expect(onClose).toHaveBeenCalledOnce();
            expect(onActivate).not.toHaveBeenCalled();
        });

        it("middle click on main area calls onClose", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            const onClose = vi.fn();
            const onActivate = vi.fn();
            tab.onClose = onClose;
            tab.onActivate = onActivate;

            tab.localPosition = new Offset(0, 0);
            tab.layout(BoxConstraints.tight(new Size(tab.getMaxIntrinsicWidth(1), 1)));

            const event = new TUIMouseEvent("click", {
                button: "middle",
                screenX: 3,
                screenY: 0,
                localX: 3,
                localY: 0,
            });
            tab.dispatchEvent(event);

            expect(onClose).toHaveBeenCalledOnce();
            expect(onActivate).not.toHaveBeenCalled();
        });

        it("middle click on close button calls onClose once", () => {
            const tab = new EditorTabItemElement("file.ts", tsIcon.icon, tsIcon.color);
            const onClose = vi.fn();
            const onActivate = vi.fn();
            tab.onClose = onClose;
            tab.onActivate = onActivate;

            const w = tab.getMaxIntrinsicWidth(1);
            tab.localPosition = new Offset(0, 0);
            tab.layout(BoxConstraints.tight(new Size(w, 1)));

            const closeX = w - 1 - 1; // paddingRight=1, close char len=1
            const event = new TUIMouseEvent("click", {
                button: "middle",
                screenX: closeX,
                screenY: 0,
                localX: closeX,
                localY: 0,
            });
            tab.dispatchEvent(event);

            expect(onClose).toHaveBeenCalledOnce();
            expect(onActivate).not.toHaveBeenCalled();
        });
    });

    describe("rendering under tight width", () => {
        it("omits the space after the icon when the icon fills the last column", () => {
            // paddingLeft=0, single-cell icon, width=1: the icon lands at the last
            // column, so the trailing-space branch (x < width) is skipped.
            const tab = new EditorTabItemElement("file.ts", "I", packRgb(1, 2, 3), { paddingLeft: 0 });
            const { text } = renderTab(tab, 1);
            expect(text).toBe("I");
        });

        it("omits the close button when there is no room left for it", () => {
            // Width fits the icon + a label char but leaves no room for " ×"
            // (x + 1 < width is false), so the close button is not drawn.
            const tab = new EditorTabItemElement("AB", "", packRgb(1, 2, 3), { paddingLeft: 0 });
            const { text } = renderTab(tab, 2);
            expect(text).toBe("AB");
            expect(text).not.toContain("×");
        });
    });
});
