import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

/**
 * Виджет такой один — `EditorElement`, но пара ключей `textViewFocus`/`textInputFocus`
 * жива: when-клаузы несут разную семантику («нужна каретка» против «нужен ввод»).
 */
export interface ITextViewElement extends TUIElement {
    readonly viewState: EditorViewState;
    readonly readOnly: boolean;
}

export function isTextViewElement(element: TUIElement | null): element is ITextViewElement {
    return element instanceof EditorElement;
}
