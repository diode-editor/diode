import type { TUIElement } from "../tuiElement.ts";

import type { TUIKeyboardEvent } from "./tuiKeyboardEvent.ts";
import type { TUIMouseEvent } from "./tuiMouseEvent.ts";
import { TUIContextMenuEvent } from "./tuiMouseEvent.ts";

/**
 * Единственное место, знающее, какой ввод означает «открой контекстное меню»:
 * правый клик, клавиша ContextMenu (Kitty 57363) и Shift+F10 сливаются в одно
 * событие "contextmenu" с нормализованным якорем — потребитель не различает,
 * откуда меню пришло.
 */

/** Правый click → contextmenu с якорем-точкой; прочие кнопки — null. */
export function contextMenuEventFromClick(click: TUIMouseEvent): TUIContextMenuEvent | null {
    if (click.button !== "right") return null;
    return new TUIContextMenuEvent({
        trigger: "mouse",
        button: click.button,
        screenX: click.screenX,
        screenY: click.screenY,
        localX: click.localX,
        localY: click.localY,
        shiftKey: click.shiftKey,
        altKey: click.altKey,
        ctrlKey: click.ctrlKey,
    });
}

/**
 * Keydown ContextMenu / Shift+F10 → contextmenu с якорем-элементом; прочие
 * клавиши — null. Координаты — глобальная позиция target как fallback.
 */
export function contextMenuEventFromKeydown(event: TUIKeyboardEvent, target: TUIElement): TUIContextMenuEvent | null {
    if (event.ctrlKey || event.altKey || event.metaKey) return null;
    const isContextMenuKey = event.key === "ContextMenu";
    const isShiftF10 = event.key === "F10" && event.shiftKey;
    if (!isContextMenuKey && !isShiftF10) return null;
    return new TUIContextMenuEvent({
        trigger: "keyboard",
        button: "none",
        screenX: target.globalPosition.x,
        screenY: target.globalPosition.y,
        localX: 0,
        localY: 0,
        shiftKey: event.shiftKey,
    });
}
