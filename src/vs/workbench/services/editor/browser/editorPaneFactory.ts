import * as fs from "node:fs";

import { Uri } from "../../../../base/common/uri.ts";
import type { ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
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
 * аналог upstream `EditorInput.copy()` + `EditorPaneDescriptor.describes` +
 * `IEditorSerializer`). Рецепт — plain-объект, а не input с жизненным циклом:
 * панель у нас сама владеет моделью через ссылку реестра, так что второй
 * объект-владелец не нужен.
 *
 * Через рецепт ядро повторяет вкладку любого вида, не зная этого вида: сплит и
 * копия в соседнюю группу ({@link EditorService.splitActiveGroup},
 * `copyActiveEditorToGroup`) и рестор сессии (`WorkbenchStateService`).
 *
 * Методы объявлены методами, а не полями-функциями, намеренно: параметры методов
 * бивариантны, поэтому фабрики разных рецептов живут в одном списке.
 */
export interface IEditorPaneFactory<D> {
    /**
     * Идентичность вида в сессии: по нему сохранённая запись находит свою
     * фабрику. Значения — upstream `typeId` соответствующих input'ов.
     */
    readonly typeId: string;

    /**
     * Вкладка вида одна на окно (upstream `EditorInputCapabilities.Singleton`):
     * сплит и копия в группу её не повторяют.
     */
    readonly singleton?: boolean;

    /** Рецепт вкладки своего вида; `undefined` — вкладка не своя либо повторить её нельзя. */
    describe(pane: IEditorPane): D | undefined;

    /** Рецепт → строка для сессии; `undefined` — вкладка не переживает рестарт. */
    serialize(descriptor: D): string | undefined;

    /** Строка сессии → рецепт; `undefined` — повторить уже нельзя (файл удалён и т.п.). */
    deserialize(value: string): D | undefined;

    /**
     * Открыть вкладку по рецепту в группе. Ресурс там уже открыт — активируется
     * существующая вкладка. Обещание не отклоняется: неудачу открытия фабрика
     * доносит сама.
     */
    open(descriptor: D, target: IEditorPaneOpenTarget): Promise<void>;
}

/**
 * Фабрики вкладок из contrib — явным списком, который собирает модуль профиля
 * (узаконенное отклонение от upstream-реестра: `services/editor` про contrib не
 * знает). Фабрика получает контейнер при создании и ходит в него лениво — в
 * `open`, а не в конструкторе: так её создание не тянет за собой граф сервисов.
 */
export type EditorPaneFactoryCtor = (accessor: ServiceAccessor) => IEditorPaneFactory<unknown>;

export const EditorPaneFactoriesDIToken = token<readonly IEditorPaneFactory<unknown>[]>("EditorPaneFactories");

/** Каретка и скролл — что переезжает с текстовой вкладкой в её копию (US-1). */
export interface ITextEditorViewState {
    readonly selections: readonly ISelection[];
    readonly scrollTop: number;
    readonly scrollLeft: number;
}

/** Рецепт текстовой вкладки: ресурс и вид на него (из сессии — без вида). */
export interface ITextEditorPaneDescriptor {
    readonly uri: Uri;
    readonly viewState?: ITextEditorViewState;
}

/** upstream `FILE_EDITOR_INPUT_ID`: в сессию текстовая фабрика пишет только файлы. */
export const TEXT_EDITOR_PANE_TYPE_ID = "workbench.editors.files.fileEditorInput";

/** Что текстовой фабрике нужно от `EditorService`. */
export interface ITextEditorPaneFactoryHost {
    /** Откроется ли ресурс заново по одному uri (см. `EditorService.canRestore`). */
    canRestore(uri: Uri): boolean;
    openUri(uri: Uri, options: { focus: boolean; group: EditorGroup; viewState?: ITextEditorViewState }): Promise<void>;
}

/**
 * Фабрика текстовых вкладок: файл с диска (общая модель через реестр) и
 * недисковый ресурс, пока его схему обслуживает провайдер (`jdt:`). Безымянный
 * буфер не повторяется — его модель принадлежит одной вкладке, общей для
 * untitled в реестре нет (E3). Рестарт переживают только файлы: провайдер
 * недискового ресурса появляется лишь с активацией расширения.
 */
export function createTextEditorPaneFactory(
    host: ITextEditorPaneFactoryHost,
): IEditorPaneFactory<ITextEditorPaneDescriptor> {
    return {
        typeId: TEXT_EDITOR_PANE_TYPE_ID,
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
        serialize({ uri }) {
            return uri.scheme === "file" ? uri.toString() : undefined;
        },
        deserialize(value) {
            const uri = Uri.parse(value);
            return uri.scheme === "file" && fs.existsSync(uri.fsPath) ? { uri } : undefined;
        },
        open({ uri, viewState }, { group, focus }) {
            return host.openUri(uri, { group, focus, viewState });
        },
    };
}
