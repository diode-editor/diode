import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";

/**
 * Что группе нужно от любой панели (у vscode это `EditorInput` + `EditorPane`, у нас
 * панель сама себе и модель, и view). Всё текстовое — на {@link TextEditorPane}.
 */
export interface IEditorPane extends IDisposable {
    /** Он же идентичность вкладки: повторное открытие ресурса переключает на неё. */
    readonly uri: Uri;

    /** Отдельно от {@link uri}: у диффа метка вроде `a.ts ↔ HEAD`, которой нет в пути. */
    readonly label: string;

    readonly view: TUIElement;

    readonly isModified: boolean;

    readonly readOnly: boolean;

    /** Файл удалён с диска, а модель жива (orphaned эталона): вкладка зачёркнута. */
    readonly isOrphaned?: boolean;

    /** Через него работают команды курсора; у панели любого вида (картинка) его может не быть. */
    readonly viewState?: EditorViewState;

    /**
     * В документном порядке, по выделению: в мультикурсоре Cut обязан скопировать ровно
     * то, что удаляет. Отдельно от `viewState.getSelectedTexts()`: панель вправе решить
     * иначе (дифф выбрасывает плейсхолдеры свёрнутых кусков).
     */
    getSelectedTexts(): string[];

    /** Маркер правки, метка — группе незачем знать про EOL и состояние файла на диске. */
    onDidChangeState(cb: () => void): IDisposable;

    focusEditor(): void;
}
