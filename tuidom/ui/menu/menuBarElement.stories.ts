import type { StoryContext, StoryMeta } from "../../testing/storyTypes.ts";
import { FocusableBox } from "../../demos/FocusableBox.ts";
import { VStackElement } from "../layout/vStackElement.ts";

import type { MenuBarItem } from "./menuBarElement.ts";
import { MenuBarElement } from "./menuBarElement.ts";

export const meta: StoryMeta = {
    title: "MenuBarElement",
};

export function ideMenu(ctx: StoryContext): void {
    const menuItems: MenuBarItem[] = [
        {
            label: "File",
            mnemonic: "f",
            entries: [
                { label: "New File", shortcut: "Ctrl+N" },
                { label: "Open File", shortcut: "Ctrl+O" },
                { type: "separator" },
                { label: "Save", shortcut: "Ctrl+S" },
                { label: "Save As...", shortcut: "Ctrl+Shift+S" },
                { type: "separator" },
                { label: "Exit", shortcut: "Ctrl+Q" },
            ],
        },
        {
            label: "Edit",
            mnemonic: "e",
            entries: [
                { label: "Undo", shortcut: "Ctrl+Z" },
                { label: "Redo", shortcut: "Ctrl+Shift+Z" },
                { type: "separator" },
                { label: "Cut", shortcut: "Ctrl+X" },
                { label: "Copy", shortcut: "Ctrl+C" },
                { label: "Paste", shortcut: "Ctrl+V" },
            ],
        },
        {
            label: "View",
            mnemonic: "v",
            entries: [
                { label: "Toggle Sidebar" },
                { label: "Toggle Terminal" },
                { type: "separator" },
                { label: "Zoom In", shortcut: "Ctrl+=" },
                { label: "Zoom Out", shortcut: "Ctrl+-" },
            ],
        },
        {
            label: "Help",
            mnemonic: "h",
            entries: [{ label: "About" }],
        },
    ];

    const menuBar = new MenuBarElement(menuItems);
    const stack = new VStackElement();

    const labels = ["Inbox", "Drafts", "Sent", "Trash", "Settings"];
    for (const label of labels) {
        stack.addChild(new FocusableBox(label), { width: "fill", height: 3 });
    }

    ctx.body.setMenuBar(menuBar);
    ctx.body.setContent(stack);
}
