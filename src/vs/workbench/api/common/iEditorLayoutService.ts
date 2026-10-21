import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type {
    IWireCloseGroupsParams,
    IWireCloseTabsParams,
    IWireCreateUntitledParams,
    IWireEditorLayout,
    IWireShowTextDocumentParams,
    IWireShowTextDocumentResult,
    IWireUriParams,
} from "./wireTypes.ts";

export interface IEditorLayoutService {
    getLayoutSnapshot(): IWireEditorLayout;

    /** Реализация коалесирует per-microtask. */
    onDidChangeLayout(cb: (layout: IWireEditorLayout) => void): IDisposable;

    /**
     * `editor.layoutChanged` обязан уйти раньше `editor.activeEditorChanged` и ответа
     * show/close — иначе расширение после `await` увидит устаревший `tabGroups`.
     */
    flushPendingLayout(): void;

    showTextDocument(params: IWireShowTextDocumentParams): Promise<IWireShowTextDocumentResult>;

    /** Безымянный документ без вкладки; показывает его потом {@link showTextDocument}. */
    createUntitledDocument(params: IWireCreateUntitledParams): IWireUriParams;

    /** `false` — пользователь отменил confirm-диалог. */
    closeTabs(params: IWireCloseTabsParams): Promise<boolean>;

    closeGroups(params: IWireCloseGroupsParams): Promise<boolean>;
}

export const NULL_EDITOR_LAYOUT_SERVICE: IEditorLayoutService = {
    getLayoutSnapshot: () => ({ groups: [] }),
    onDidChangeLayout: () => ({ dispose: () => undefined }),
    flushPendingLayout: () => undefined,
    showTextDocument: () => Promise.reject(new Error("editor layout unavailable")),
    createUntitledDocument: () => {
        throw new Error("editor layout unavailable");
    },
    closeTabs: () => Promise.resolve(false),
    closeGroups: () => Promise.resolve(false),
};
