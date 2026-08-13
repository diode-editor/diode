import type { TUIElement } from "@tuidom/all/dom/tuiElement";
import type { OverlayAnchorPosition } from "@tuidom/all/ui/contextview/overlayLayer";
import type { MenuEntry } from "@tuidom/all/ui/menu/popupMenuElement";
import type { MenuId } from "../../actions/common/menuId.ts";

/**
 * Делегат открытия контекстного меню (аналог `IContextMenuDelegate` VS Code):
 * виджет ничего не привязывает к себе заранее — в момент открытия отдаёт
 * якорь и, при желании, собственные пункты.
 */
export interface IContextMenuDelegate {
    /** Владелец меню — по нему ищется overlay-слой показа. */
    getOwner(): TUIElement;
    getAnchor(): OverlayAnchorPosition;
    /** Собственные пункты делегата (поверх реестровых, если есть menuId). */
    getEntries?(): MenuEntry[];
    onHide?(): void;
}

/**
 * Делегат с точкой реестра (аналог `IContextMenuMenuDelegate`): пункты
 * собираются из `MenuRegistry` по `menuId` с учётом `when`-контекста и
 * склеиваются с собственными пунктами делегата через сепаратор.
 */
export interface IContextMenuMenuDelegate extends IContextMenuDelegate {
    readonly menuId: MenuId;
    /** Контекст открытия — попадает в args команд и `when`-выражения пунктов. */
    readonly menuContext?: unknown;
}
