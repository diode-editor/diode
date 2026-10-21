import * as fs from "node:fs";

import { Uri } from "../../../../base/common/uri.ts";
import type { ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

import type { EditorGroup } from "./editorGroupModel.ts";

export interface IEditorPaneOpenTarget {
    readonly group: EditorGroup;
    readonly focus: boolean;
}

/**
 * Лёгкий аналог upstream `EditorInput.copy()` + `EditorPaneDescriptor.describes` + `IEditorSerializer`.
 * Рецепт — plain-объект, а не input с жизненным циклом: панель сама владеет моделью через ссылку реестра.
 * Методы, а не поля-функции, намеренно: параметры методов бивариантны, и фабрики разных рецептов живут в одном списке.
 */
export interface IEditorPaneFactory<D> {
    /** Upstream `typeId` соответствующего input'а: по нему запись сессии находит фабрику. */
    readonly typeId: string;

    /** Upstream `EditorInputCapabilities.Singleton`: сплит и копия в группу вкладку не повторяют. */
    readonly singleton?: boolean;

    /** `undefined` — вкладка не своя либо повторить её нельзя. */
    describe(pane: IEditorPane): D | undefined;

    /** `undefined` — вкладка не переживает рестарт. */
    serialize(descriptor: D): string | undefined;

    /** `undefined` — повторить уже нельзя (файл удалён и т.п.). */
    deserialize(value: string): D | undefined;

    /** Ресурс уже открыт в группе — активируется он. Обещание не отклоняется: неудачу фабрика доносит сама. */
    open(descriptor: D, target: IEditorPaneOpenTarget): Promise<void>;
}

/**
 * Явный список, собранный модулем профиля (отклонение от upstream-реестра: `services/editor` про contrib
 * не знает). В контейнер фабрика ходит лениво, в `open`: её создание не тянет граф сервисов.
 */
export type EditorPaneFactoryCtor = (accessor: ServiceAccessor) => IEditorPaneFactory<unknown>;

export const EditorPaneFactoriesDIToken = token<readonly IEditorPaneFactory<unknown>[]>("EditorPaneFactories");

/** Что переезжает с текстовой вкладкой в её копию (US-1). */
export interface ITextEditorViewState {
    readonly selections: readonly ISelection[];
    readonly scrollTop: number;
    readonly scrollLeft: number;
}

/** Из сессии — без `viewState`. */
export interface ITextEditorPaneDescriptor {
    readonly uri: Uri;
    readonly viewState?: ITextEditorViewState;
}

/** upstream `FILE_EDITOR_INPUT_ID`: в сессию текстовая фабрика пишет только файлы. */
export const TEXT_EDITOR_PANE_TYPE_ID = "workbench.editors.files.fileEditorInput";

export interface ITextEditorPaneFactoryHost {
    canRestore(uri: Uri): boolean;
    openUri(uri: Uri, options: { focus: boolean; group: EditorGroup; viewState?: ITextEditorViewState }): Promise<void>;
}

/**
 * Безымянный буфер не повторяется — общей модели для untitled в реестре нет (E3). Рестарт переживают
 * только файлы: провайдер недискового ресурса появляется лишь с активацией расширения.
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
