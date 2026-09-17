import type { TUIElement } from "@tuidom/core/dom/tuiElement";

/**
 * Id строки списка для обработчиков `ListViewElement` (`onActivate`,
 * `onSelect`, `onContextMenu`).
 *
 * `appendRow` движка отвергает строки без id, поэтому в обработчик всегда
 * приходит элемент с id — но тип `TUIElement.id` об этом не знает. Одно место,
 * где инвариант записан, вместо non-null-утверждения на каждом обработчике;
 * недостижимая пустая строка ни с чем не совпадёт в таблицах строк.
 */
export function listRowId(element: TUIElement): string {
    return element.id ?? "";
}
