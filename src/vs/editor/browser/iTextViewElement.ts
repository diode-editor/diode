import type { TUIElement } from "../../../../tuidom/dom/tuiElement.ts";
import type { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { DiffViewElement } from "./diffViewElement.ts";
import { EditorElement } from "./editorElement.ts";

/**
 * Виджет с текстовой поверхностью: у него есть каретка, выделение и скролл над
 * {@link EditorViewState}. Таких два — редактор и инлайн-дифф.
 *
 * Нужен, чтобы контекст-ключ `textViewFocus` мог отличить «фокус в тексте» от
 * «фокус в редактируемом буфере» (`textInputFocus`, только `EditorElement`).
 * Слить их в один нельзя: на `textInputFocus` висят правка, фолдинг, suggest,
 * find и goto-definition — все они ходят через `getActiveEditor()`, который на
 * диффе отдаёт `null`. Резолвнувшаяся команда съедает клавишу
 * (`swallowNextKeyPress`), поэтому «просто расширить `textInputFocus`» сделало
 * бы дифф немым, а не всемогущим.
 */
export interface ITextViewElement extends TUIElement {
    readonly viewState: EditorViewState;
    readonly readOnly: boolean;
}

export function isTextViewElement(element: TUIElement | null): element is ITextViewElement {
    return element instanceof EditorElement || element instanceof DiffViewElement;
}
