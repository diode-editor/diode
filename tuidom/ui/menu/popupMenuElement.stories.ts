import type { StoryContext, StoryMeta } from "../../testing/storyTypes.ts";
import { Point } from "../../common/geometryPromitives.ts";
import { BoxElement } from "../layout/boxElement.ts";

import { PopupMenuElement } from "./popupMenuElement.ts";

export const meta: StoryMeta = {
    title: "PopupMenuElement",
};

export function contextMenu(ctx: StoryContext): void {
    ctx.body.title = "Press 'm' to open menu, Escape to close";

    const background = new BoxElement();
    ctx.body.setContent(background);

    const menu = new PopupMenuElement([
        { label: "New File", shortcut: "Ctrl+N", icon: "\uf15b" },
        { label: "Open File", shortcut: "Ctrl+O", icon: "\uf115" },
        { type: "separator" },
        { label: "Save", shortcut: "Ctrl+S", icon: "\uf0c7" },
        { label: "Save As...", shortcut: "Ctrl+Shift+S" },
        { type: "separator" },
        { label: "Close", shortcut: "Ctrl+W", icon: "\uf00d" },
    ]);

    ctx.body.overlayLayer.addItem(menu, new Point(5, 3), false);

    menu.onClose = () => {
        ctx.body.overlayLayer.setVisible(menu, false);
    };

    ctx.body.addEventListener("keydown", (event) => {
        if (event.key === "m" && !ctx.body.overlayLayer.hasVisibleItems()) {
            ctx.body.overlayLayer.setVisible(menu, true);
        }
    });
}
