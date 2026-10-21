import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickPickElement } from "./quickPickElement.ts";

function makePicker(width = 30): QuickPickElement {
    const picker = new QuickPickElement();
    picker.preferredWidth = width;
    // The default placeholder clutters the frame; tests that need one set their own.
    picker.placeholder = "";
    return picker;
}

function render(picker: QuickPickElement, width = 30) {
    return renderElement(picker, width, picker.getMinIntrinsicHeight(width), { themeVars: true });
}

function makeItems(count: number): QuickPickItem[] {
    return Array.from({ length: count }, (_, i) => ({ label: `file-${String(i + 1)}.ts` }));
}

describe("QuickPickElement — layout", () => {
    // The bug that prompted moving the widget: the query was drawn flush against the border, the list further right.
    it("query, message and list rows start in the same column", () => {
        const picker = makePicker(24);
        picker.setQuery("cfg");
        picker.validationMessage = "Name is taken";
        picker.items = [{ label: "Alpha" }, { label: "Beta" }];

        expectScreen(
            render(picker, 24),
            screen`
                ╭──────────────────────╮
                │ cfg                  │
                │ Name is taken        │
                ├──────────────────────┤
                │ Alpha                │
                │ Beta                 │
                ╰──────────────────────╯
            `,
        );
    });

    it("an empty picker is border, query row with placeholder, border", () => {
        const picker = makePicker(20);
        picker.placeholder = "Go to file...";

        expectScreen(
            render(picker, 20),
            screen`
                ╭──────────────────╮
                │ Go to file...    │
                ╰──────────────────╯
            `,
        );
    });

    it("the title is inset into the top border", () => {
        const picker = makePicker(24);
        picker.title = "Save As";
        picker.setQuery("note.txt");

        expectScreen(
            render(picker, 24),
            screen`
                ╭─────┤ Save As ├──────╮
                │ note.txt             │
                ╰──────────────────────╯
            `,
        );
    });

    it("the description is flush with the content's right edge, one column from the border", () => {
        const picker = makePicker(30);
        picker.items = [{ label: "main.ts", description: "src/vs" }];

        expectScreen(
            render(picker, 30),
            screen`
                ╭────────────────────────────╮
                │                            │
                ├────────────────────────────┤
                │ main.ts             src/vs │
                ╰────────────────────────────╯
            `,
        );
    });

    it("a long message is cut at the same right padding as the rows", () => {
        const picker = makePicker(24);
        picker.validationMessage = "This message is far too long to fit";
        picker.items = [{ label: "Alpha" }];
        const backend = render(picker, 24);

        // Content ends at column w-3, followed by padding and the border.
        expect(backend.getTextAt(new Point(21, 2), 1)).not.toBe(" ");
        expect(backend.getTextAt(new Point(22, 2), 1)).toBe(" ");
        expect(backend.getTextAt(new Point(23, 2), 1)).toBe("│");
    });

    it("every row gets an icon column if at least one row has an icon", () => {
        const picker = makePicker(24);
        picker.items = [{ icon: "A", label: "Alpha" }, { label: "Beta" }];

        expectScreen(
            render(picker, 24),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ A Alpha              │
                │   Beta               │
                ╰──────────────────────╯
            `,
        );
    });

    it("shortcut and hint come after the description, on the right", () => {
        const picker = makePicker(34);
        picker.items = [{ label: "Save", shortcut: "Ctrl+S" }];
        const row = render(picker, 34).getTextAt(new Point(0, 3), 34);

        expect(row).toContain("Save");
        expect(row).toContain("Ctrl+S");
    });

    it("the label wins: the description shrinks, not the label", () => {
        const picker = makePicker(28);
        picker.items = [{ label: "main.ts", description: "src/vs/workbench/browser/parts" }];
        const row = render(picker, 28).getTextAt(new Point(0, 3), 28);

        expect(row).toContain("main.ts");
        expect(row).toContain("…");
    });

    it("the selected row uses the active selection color", () => {
        const picker = makePicker(24);
        picker.items = makeItems(2);
        const backend = render(picker, 24);

        // Row 3 is the first item (selected by default), row 4 the second.
        const selectedBg = backend.getBgAt(new Point(2, 3));
        const plainBg = backend.getBgAt(new Point(2, 4));
        expect(selectedBg).not.toBe(plainBg);
    });

    // Regression #94: the selection highlight must not spill onto the border.
    it("the selection fills the whole interior and leaves the border columns alone", () => {
        const picker = makePicker(24);
        picker.items = makeItems(2);
        const backend = render(picker, 24);

        const frameBg = backend.getBgAt(new Point(0, 4)); // border of an unselected row
        expect(backend.getBgAt(new Point(0, 3))).toBe(frameBg);
        expect(backend.getBgAt(new Point(23, 3))).toBe(frameBg);

        const selectionBg = backend.getBgAt(new Point(2, 3));
        expect(selectionBg).not.toBe(frameBg);
        expect(backend.getBgAt(new Point(1, 3))).toBe(selectionBg);
        expect(backend.getBgAt(new Point(22, 3))).toBe(selectionBg);
    });

    it("a title too long for the border is dropped — the border is drawn without it", () => {
        const picker = makePicker(14);
        picker.title = "Configure Keyboard Shortcuts";
        const backend = render(picker, 14);

        expect(backend.getTextAt(new Point(0, 0), 14)).toBe("╭────────────╮");
    });

    it("the hint follows the description on the right", () => {
        const picker = makePicker(40);
        picker.items = [{ label: "Bind", description: "keyboard", hint: "Configure Binding" }];
        const row = render(picker, 40).getTextAt(new Point(0, 3), 40);

        expect(row).toContain("Bind");
        expect(row).toContain("Configure Binding");
    });

    it("draws nothing into an area smaller than the border", () => {
        const picker = makePicker(10);
        picker.items = makeItems(2);
        const backend = renderElement(picker, 1, 1, { themeVars: true });

        expect(backend.getTextAt(new Point(0, 0), 1)).toBe(" ");
    });

    it("severity colors the message with its own color", () => {
        const colorAt = (severity: "error" | "warning" | "info"): number => {
            const picker = makePicker(24);
            picker.validationMessage = "Careful";
            picker.validationSeverity = severity;
            return render(picker, 24).getFgAt(new Point(2, 2));
        };

        const error = colorAt("error");
        const warning = colorAt("warning");
        const info = colorAt("info");
        expect(new Set([error, warning, info]).size).toBe(3);
    });

    it("no room for the description — a truncated label remains", () => {
        const picker = makePicker(16);
        picker.items = [{ label: "averylonglabel", description: "src/vs" }];
        const row = render(picker, 16).getTextAt(new Point(0, 3), 16);

        expect(row).toContain("averylongla…");
        expect(row).not.toContain("src/vs");
    });

    it("the picker's minimum width is 20 columns", () => {
        expect(makePicker(60).getMinIntrinsicWidth(3)).toBe(20);
    });

    it("height = border + query + [message] + [separator + rows] + border", () => {
        const picker = makePicker();
        expect(picker.getMinIntrinsicHeight(30)).toBe(3);

        picker.prompt = "Enter a name";
        expect(picker.getMinIntrinsicHeight(30)).toBe(4);

        picker.prompt = undefined;
        picker.items = makeItems(3);
        expect(picker.getMinIntrinsicHeight(30)).toBe(7); // 1 + 1 + 1 + 3 + 1
    });

    it("the list is no longer than maxVisibleItems", () => {
        const picker = makePicker();
        picker.maxVisibleItems = 2;
        picker.items = makeItems(10);
        expect(picker.getMinIntrinsicHeight(30)).toBe(6); // 1 + 1 + 1 + 2 + 1
    });

    // The picker must shrink into the given height with an intact bottom border, not get clipped.
    it("on a short terminal the list window shrinks and the bottom border stays intact", () => {
        const picker = makePicker(24);
        picker.items = makeItems(10);
        const backend = renderElement(picker, 24, 6, { themeVars: true });

        expect(backend.getTextAt(new Point(0, 5), 1)).toBe("╰");
        expect(backend.getTextAt(new Point(2, 3), 9)).toBe("file-1.ts");
        expect(backend.getTextAt(new Point(2, 4), 9)).toBe("file-2.ts");
    });
});
