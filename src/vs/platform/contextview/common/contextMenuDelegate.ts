import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";

import type { MenuId } from "../../actions/common/menuId.ts";

export interface IContextMenuDelegate {
    /** По нему ищется overlay-слой показа. */
    getOwner(): TUIElement;
    getAnchor(): OverlayAnchorPosition;
    getEntries?(): MenuEntry[];
    onHide?(): void;
}

export interface IContextMenuMenuDelegate extends IContextMenuDelegate {
    readonly menuId: MenuId;
    /** Попадает в args команд и `when` пунктов. */
    readonly menuContext?: unknown;
}
