import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type {
    IWireChangeLanguageParams,
    IWireChangeLanguageResult,
    IWireCloseGroupsParams,
    IWireCloseTabsParams,
    IWireCreateUntitledParams,
    IWireEditorLayout,
    IWireOpenTextDocumentParams,
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

    getLanguages(): readonly string[];

    /**
     * The extension host opens a document the core has no model for (a content provider's, a file system
     * provider's): its language — set by {@link changeDocumentLanguage} while it waits for a model, otherwise by the
     * path. The language's features start, as upstream's `$tryOpenDocument` creates a model and
     * `requestRichLanguageFeatures` activates `onLanguage:<id>`: Angular's virtual `.html` template wakes the HTML
     * extension.
     */
    openDocumentWithoutModel(uri: string): string | null;

    /** Upstream `$changeLanguage`. Throws on an unknown language. A document without a model gets it when one appears. */
    changeDocumentLanguage(params: IWireChangeLanguageParams): IWireChangeLanguageResult;
    /** A live model without a tab, upstream `$tryOpenDocument`. `null`: not a readable file. */
    openTextDocument(params: IWireOpenTextDocumentParams): Promise<IWireUriParams | null>;

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
    getLanguages: () => [],
    openDocumentWithoutModel: () => null,
    changeDocumentLanguage: () => {
        throw new Error("editor layout unavailable");
    },
    openTextDocument: () => Promise.resolve(null),
    closeTabs: () => Promise.resolve(false),
    closeGroups: () => Promise.resolve(false),
};
