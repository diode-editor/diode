import type { TUIElement } from "../../dom/tuiElement.ts";
import type { MenuEntry } from "../menu/popupMenuElement.ts";
import { PopupMenuElement } from "../menu/popupMenuElement.ts";

import type { OverlayAnchorPosition, OverlaySessionHandle } from "./overlayLayer.ts";

export interface ContextMenuShowRequest {
    /** Владелец меню — по нему ищется ближайший overlay-слой. */
    owner: TUIElement;
    anchor: OverlayAnchorPosition;
    entries: MenuEntry[];
    onHide?: () => void;
}

/**
 * Механика показа контекстного меню: PopupMenuElement в overlay-сессии с
 * каноническим поведением — флип у краёв экрана, Escape и клик мимо закрывают,
 * фокус после закрытия возвращается прежнему владельцу, выбор пункта сперва
 * закрывает меню. Владеет единственной активной сессией: показ нового меню
 * закрывает предыдущее. Состав пунктов — не его дело (его собирает вызывающий).
 */
export class ContextMenuController {
    private session: OverlaySessionHandle | null = null;

    public show(request: ContextMenuShowRequest): void {
        this.hide();
        const layer = request.owner.getOverlayLayer();
        if (!layer || request.entries.length === 0) return;

        // Выбор пункта закрывает меню ДО действия: команда может открыть
        // диалог/переставить фокус, и restoreFocus сессии не должен затирать
        // фокус, выставленный командой. Подменю закрывают цепочку сами.
        const entries: MenuEntry[] = request.entries.map((entry) => {
            if (entry.type === "separator" || entry.type === "submenu") return entry;
            const original = entry.onSelect;
            return {
                ...entry,
                onSelect: () => {
                    this.hide();
                    original?.();
                },
            };
        });

        const menu = new PopupMenuElement(entries);
        menu.focusable = true;

        let session: OverlaySessionHandle | null = null;
        session = layer.openPopupSession(menu, request.anchor, {
            visible: true,
            restoreFocus: true,
            focusOnOpen: true,
            closeOnEscape: true,
            pointerPolicy: "close-on-outside",
            disposeOnClose: true,
            // Клик по вложенному подменю (отдельный item слоя) — не «мимо».
            ownsTarget: (target) => menu.ownsElement(target),
            // Escape при открытом подменю закрывает уровень, а не всё меню, —
            // роутинг делает само меню (performDefaultAction).
            shouldCloseOnEscape: () => !menu.hasOpenSubmenu(),
            onClose: () => {
                // Сессия закрыта (Escape, клик мимо, hide) — каскадно закрываем
                // открытые подменю: их сессии слой сам не увяжет.
                menu.closeSubmenus();
                // Через hide() поле занулено до close() — не трогаем: там может
                // быть уже открыта следующая сессия.
                if (this.session === session) {
                    this.session = null;
                }
                request.onHide?.();
            },
        });
        menu.onClose = () => {
            session.close();
        };
        this.session = session;
    }

    public hide(): void {
        if (!this.session) return;
        const session = this.session;
        this.session = null;
        // Именно close(), не dispose(): close восстанавливает сохранённый фокус
        // (restoreFocus), а disposeOnClose доводит teardown до конца.
        session.close();
    }

    public isOpen(): boolean {
        return this.session !== null;
    }
}
