import type { IDisposable } from "@tuidom/core/common/disposable";

import type {
    IWireCloseGroupsParams,
    IWireCloseTabsParams,
    IWireEditorLayout,
    IWireShowTextDocumentParams,
    IWireShowTextDocumentResult,
} from "./wireTypes.ts";

/**
 * Порт `ExtensionHost` к полосе групп редакторов (снимки для
 * `editor.layoutChanged`, исполнение `editor.showTextDocument`/`closeTabs`/
 * `closeGroups`). Реализация — `EditorLayoutServiceAdapter` поверх
 * `EditorService`; хост зависит только от порта (паттерн
 * {@link import("./iEditorOptionsService.ts").IEditorOptionsService}).
 */
export interface IEditorLayoutService {
    /** Текущий снимок полосы (groups → tabs, мета без текста). */
    getLayoutSnapshot(): IWireEditorLayout;

    /**
     * Изменение полосы/вкладок/активной группы. Реализация коалесирует
     * per-microtask; подписчик (хост) шлёт `editor.layoutChanged`.
     */
    onDidChangeLayout(cb: (layout: IWireEditorLayout) => void): IDisposable;

    /**
     * Синхронно доставляет отложенный коалесингом снимок (если есть) ДО
     * следующего сообщения хоста: `editor.layoutChanged` обязан уйти раньше
     * `editor.activeEditorChanged` и раньше ответа show/close — иначе
     * расширение после `await` увидит устаревший `tabGroups`.
     */
    flushPendingLayout(): void;

    /** `window.showTextDocument`: открыть/активировать ресурс в колонке. */
    showTextDocument(params: IWireShowTextDocumentParams): Promise<IWireShowTextDocumentResult>;

    /** `tabGroups.close(tab)`: false — пользователь отменил confirm-диалог. */
    closeTabs(params: IWireCloseTabsParams): Promise<boolean>;

    /** `tabGroups.close(group)`: закрыть все вкладки групп (группы схлопнутся). */
    closeGroups(params: IWireCloseGroupsParams): Promise<boolean>;
}

/** Пустой порт для тестов/окружений без групповой поверхности. */
export const NULL_EDITOR_LAYOUT_SERVICE: IEditorLayoutService = {
    getLayoutSnapshot: () => ({ groups: [] }),
    onDidChangeLayout: () => ({ dispose: () => undefined }),
    flushPendingLayout: () => undefined,
    showTextDocument: () => Promise.reject(new Error("editor layout unavailable")),
    closeTabs: () => Promise.resolve(false),
    closeGroups: () => Promise.resolve(false),
};
