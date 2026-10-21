import type { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorElement } from "../../../browser/editorElement.ts";
import type { IPosition } from "../../../common/core/iPosition.ts";
import { rangeContainsPosition } from "../../../common/core/iRange.ts";
import { createCursorSelection, selectionToRange } from "../../../common/core/iSelection.ts";

export const ContextMenuControllerDIToken = token<ContextMenuController>("EditorContextMenuController");

/** Inclusive bounds, like upstream `containsPosition`. */
function selectionsContain(editor: EditorElement, position: IPosition): boolean {
    return editor.viewState.selections.some((selection) =>
        rangeContainsPosition(selectionToRange(selection), position),
    );
}

function findEditor(target: TUIElement | null): EditorElement | null {
    let current: TUIElement | null = target;
    while (current !== null) {
        if (current instanceof EditorElement) return current;
        current = current.getParent();
    }
    return null;
}

/**
 * Counterpart of VS Code `editor/contrib/contextmenu`. {@link attach} goes on
 * `EditorComponent.view`: the wiring outlives EditorElement being recreated on reload,
 * so the editor itself is taken from the event target.
 */
export class ContextMenuController {
    public static dependencies = [ContextMenuServiceDIToken, IConfigurationServiceDIToken] as const;

    public constructor(
        private readonly contextMenuService: ContextMenuService,
        private readonly configurationService: IConfigurationService,
    ) {}

    public attach(view: TUIElement): void {
        view.addEventListener("contextmenu", (event) => {
            this.onContextMenu(event as TUIContextMenuEvent);
        });
    }

    private onContextMenu(event: TUIContextMenuEvent): void {
        const editor = findEditor(event.target);
        if (!editor || event.defaultPrevented) return;

        editor.focus();

        let anchor: OverlayAnchorPosition;
        if (event.trigger === "mouse") {
            // Upstream moves the cursor even when editor.contextmenu is off.
            const pos = editor.docPositionAt(
                event.screenX - editor.globalPosition.x,
                event.screenY - editor.globalPosition.y,
            );
            if (!selectionsContain(editor, pos)) {
                editor.viewState.selections = [createCursorSelection(pos.line, pos.character)];
            }
            anchor = { screenX: event.screenX, screenY: event.screenY };
        } else {
            const cell = editor.getCaretScreenCell() ?? editor.globalPosition;
            anchor = { screenX: cell.x, screenY: cell.y };
        }

        if (!this.configurationService.get("editor.contextmenu")) return;

        event.preventDefault();
        this.contextMenuService.showContextMenu({
            getOwner: () => editor,
            getAnchor: () => anchor,
            menuId: MenuId.EditorContext,
        });
    }
}
