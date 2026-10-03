import type { Uri } from "../../../../base/common/uri.ts";
import type { ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

import type { EditorGroup } from "./editorGroupModel.ts";

/** Куда открыть вкладку по рецепту. */
export interface IEditorPaneOpenTarget {
    readonly group: EditorGroup;
    readonly focus: boolean;
}

/**
 * Фабрика вкладок одного вида: «рецепт» вкладки и открытие по нему (E2 — лёгкий
 * аналог upstream `EditorInput.copy()` + `EditorPaneDescriptor.describes`).
 * Рецепт — plain-объект, а не input с жизненным циклом: панель у нас сама
 * владеет моделью через ссылку реестра, так что второй объект-владелец не нужен.
 *
 * Через рецепт ядро повторяет вкладку любого вида, не зная этого вида: сплит и
 * копия в соседнюю группу ({@link EditorService.splitActiveGroup},
 * `copyActiveEditorToGroup`).
 *
 * Методы объявлены методами, а не полями-функциями, намеренно: параметры методов
 * бивариантны, поэтому фабрики разных рецептов живут в одном списке.
 */
export interface IEditorPaneFactory<D> {
    /** Рецепт вкладки своего вида; `undefined` — вкладка не своя либо повторить её нельзя. */
    describe(pane: IEditorPane): D | undefined;

    /**
     * Открыть вкладку по рецепту в группе. Ресурс там уже открыт — активируется
     * существующая вкладка. Обещание не отклоняется: неудачу открытия фабрика
     * доносит сама.
     */
    open(descriptor: D, target: IEditorPaneOpenTarget): Promise<void>;
}

/** Каретка и скролл — что переезжает с текстовой вкладкой в её копию (US-1). */
export interface ITextEditorViewState {
    readonly selections: readonly ISelection[];
    readonly scrollTop: number;
    readonly scrollLeft: number;
}

/** Рецепт текстовой вкладки: ресурс и вид на него. */
export interface ITextEditorPaneDescriptor {
    readonly uri: Uri;
    readonly viewState: ITextEditorViewState;
}

/** Что текстовой фабрике нужно от `EditorService`. */
export interface ITextEditorPaneFactoryHost {
    /** Откроется ли ресурс заново по одному uri (см. `EditorService.canRestore`). */
    canRestore(uri: Uri): boolean;
    openUri(uri: Uri, options: { focus: boolean; group: EditorGroup; viewState: ITextEditorViewState }): Promise<void>;
}

/**
 * Фабрика текстовых вкладок: файл с диска (общая модель через реестр) и
 * недисковый ресурс, пока его схему обслуживает провайдер (`jdt:`). Безымянный
 * буфер не повторяется — его модель принадлежит одной вкладке, общей для
 * untitled в реестре нет (E3).
 */
export function createTextEditorPaneFactory(
    host: ITextEditorPaneFactoryHost,
): IEditorPaneFactory<ITextEditorPaneDescriptor> {
    return {
        describe(pane) {
            if (!(pane instanceof TextEditorPane)) return undefined;
            if (pane.uri.scheme === "untitled" || !host.canRestore(pane.uri)) return undefined;
            return {
                uri: pane.uri,
                viewState: {
                    selections: pane.viewState.cloneSelections(),
                    scrollTop: pane.viewState.scrollTop,
                    scrollLeft: pane.viewState.scrollLeft,
                },
            };
        },
        open({ uri, viewState }, { group, focus }) {
            return host.openUri(uri, { group, focus, viewState });
        },
    };
}
