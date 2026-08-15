import type { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorElement } from "../../../browser/editorElement.ts";
import type { IPosition } from "../../../common/core/iPosition.ts";
import { comparePositions } from "../../../common/core/iPosition.ts";
import { createCursorSelection, selectionToRange } from "../../../common/core/iSelection.ts";

export const ContextMenuControllerDIToken = token<ContextMenuController>("EditorContextMenuController");

/** Позиция внутри одного из выделений (границы включительно, как в upstream `containsPosition`). */
function selectionsContain(editor: EditorElement, position: IPosition): boolean {
    return editor.viewState.selections.some((selection) => {
        const range = selectionToRange(selection);
        return comparePositions(range.start, position) <= 0 && comparePositions(position, range.end) <= 0;
    });
}

/** Ближайший EditorElement вверх от цели события (клик мог прийти потомку). */
function findEditor(target: TUIElement | null): EditorElement | null {
    let current: TUIElement | null = target;
    while (current !== null) {
        if (current instanceof EditorElement) return current;
        current = current.getParent();
    }
    return null;
}

/**
 * Политика контекстного меню редактора (аналог `editor/contrib/contextmenu`
 * VS Code) — первый editor-contrib с DI-токеном. Слушает событие "contextmenu"
 * на стабильной обвязке пары ({@link attach} на `EditorComponent.view` —
 * ScrollBarDecorator переживает пересоздание EditorElement при перечитке),
 * сам EditorElement берёт из цели события — attach статeless, per-editor
 * состояния нет.
 *
 * Политика как в upstream: клик вне выделения переставляет каретку, внутри —
 * не трогает; Shift+F10 якорит меню на каретке; `editor.contextmenu: false`
 * оставляет только перестановку каретки. Состав пунктов — MenuId.EditorContext.
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
        const editor = findEditor(event.target as TUIElement | null);
        if (!editor || event.defaultPrevented) return;

        editor.focus();

        let anchor: OverlayAnchorPosition;
        if (event.trigger === "mouse") {
            // Каретка — на позицию клика, если клик пришёлся вне выделений
            // (upstream двигает её и при выключенном editor.contextmenu).
            const pos = editor.docPositionAt(
                event.screenX - editor.globalPosition.x,
                event.screenY - editor.globalPosition.y,
            );
            if (!selectionsContain(editor, pos)) {
                editor.viewState.selections = [createCursorSelection(pos.line, pos.character)];
            }
            anchor = { screenX: event.screenX, screenY: event.screenY };
        } else {
            // Клавиатура: якорь — каретка; вне вьюпорта — левый верхний угол.
            const cell = editor.getCaretScreenCell() ?? editor.globalPosition;
            anchor = { screenX: cell.x, screenY: cell.y };
        }

        if (this.configurationService.get<boolean>("editor.contextmenu", true) === false) return;

        event.preventDefault();
        this.contextMenuService.showContextMenu({
            getOwner: () => editor,
            getAnchor: () => anchor,
            menuId: MenuId.EditorContext,
        });
    }
}
