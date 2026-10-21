import type { TUIElement } from "@tuidom/core/dom/tuiElement";

/** `appendRow` движка отвергает строки без id, так что `""` недостижим — тип этого не знает. */
export function listRowId(element: TUIElement): string {
    return element.id ?? "";
}
