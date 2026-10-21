import type { TUIElement } from "@tuidom/core/dom/tuiElement";

/** The engine's `appendRow` rejects rows without an id, so `""` is unreachable; the type doesn't know that. */
export function listRowId(element: TUIElement): string {
    return element.id ?? "";
}
