import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";

import type { MenuId } from "../../actions/common/menuId.ts";

export interface IContextMenuDelegate {
    /** Used to find the overlay layer to show in. */
    getOwner(): TUIElement;
    getAnchor(): OverlayAnchorPosition;
    getEntries?(): MenuEntry[];
    onHide?(): void;
}

export interface IContextMenuMenuDelegate extends IContextMenuDelegate {
    readonly menuId: MenuId;
    /** Passed to command args and item `when` checks. */
    readonly menuContext?: unknown;
}
