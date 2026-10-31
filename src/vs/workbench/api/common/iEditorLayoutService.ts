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

    /** The implementation coalesces per microtask. */
    onDidChangeLayout(cb: (layout: IWireEditorLayout) => void): IDisposable;

    /**
     * `editor.layoutChanged` must be sent before `editor.activeEditorChanged` and the show/close
     * response, otherwise the extension sees a stale `tabGroups` after `await`.
     */
    flushPendingLayout(): void;

    showTextDocument(params: IWireShowTextDocumentParams): Promise<IWireShowTextDocumentResult>;

    /** Untitled document without a tab; {@link showTextDocument} shows it later. */
    createUntitledDocument(params: IWireCreateUntitledParams): Promise<IWireUriParams>;

    /** A live model without a tab, upstream `$tryOpenDocument`. `null`: not a readable file. */
    openTextDocument(params: IWireUriParams): Promise<IWireUriParams | null>;

    /** `false`: the user cancelled the confirm dialog. */
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
    openTextDocument: () => Promise.resolve(null),
    closeTabs: () => Promise.resolve(false),
    closeGroups: () => Promise.resolve(false),
};
