import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

/**
 * `EditorElement` is the only such widget, but both `textViewFocus`/`textInputFocus` keys
 * stay: when-clauses mean different things ("needs a cursor" vs "needs input").
 */
export interface ITextViewElement extends TUIElement {
    readonly viewState: EditorViewState;
    readonly readOnly: boolean;
}

export function isTextViewElement(element: TUIElement | null): element is ITextViewElement {
    return element instanceof EditorElement;
}
