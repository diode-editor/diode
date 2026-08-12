import type { TUIElement } from "../../../../tuidom/dom/tuiElement.ts";
import type { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

/**
 * Виджет с текстовой поверхностью: у него есть каретка, выделение и скролл над
 * {@link EditorViewState}.
 *
 * Исторически таких было два — редактор и рисованная смотрелка диффа
 * (`DiffViewElement`); дифф v2 составлен из настоящих редакторов, и остался
 * один `EditorElement`. Пара ключей `textViewFocus`/`textInputFocus` при этом
 * жива: значения совпали, но when-клаузы несут разную семантику («команде
 * нужна каретка» против «команде нужен ввод»), а мутирующие команды
 * дополнительно гейтятся `editorReadonly`.
 */
export interface ITextViewElement extends TUIElement {
    readonly viewState: EditorViewState;
    readonly readOnly: boolean;
}

export function isTextViewElement(element: TUIElement | null): element is ITextViewElement {
    return element instanceof EditorElement;
}
