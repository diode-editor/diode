import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type {
    IWireChangeLanguageParams,
    IWireChangeLanguageResult,
    IWireCloseGroupsParams,
    IWireCloseTabsParams,
    IWireCreateUntitledParams,
    IWireEditorLayout,
    IWireEditorPropertiesChanged,
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

    /**
     * Per visible editor, the sides of a diff included, only what changed since it was last reported; changes within a
     * microtask coalesce. A newly visible editor reports everything, though its starting values already ride in
     * {@link getLayoutSnapshot}. The listener sends after {@link flushPendingLayout}.
     */
    onDidChangeEditorProperties(cb: (properties: IWireEditorPropertiesChanged) => void): IDisposable;

    showTextDocument(params: IWireShowTextDocumentParams): Promise<IWireShowTextDocumentResult>;

    /** Untitled document without a tab; {@link showTextDocument} shows it later. */
    createUntitledDocument(params: IWireCreateUntitledParams): Promise<IWireUriParams>;

    getLanguages(): readonly string[];

    /** The language set by {@link changeDocumentLanguage} while it waits for a model, otherwise by the path. */
    getLanguageOfDocument(uri: string): string | null;

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
    onDidChangeEditorProperties: () => ({ dispose: () => undefined }),
    showTextDocument: () => Promise.reject(new Error("editor layout unavailable")),
    createUntitledDocument: () => {
        throw new Error("editor layout unavailable");
    },
    getLanguages: () => [],
    getLanguageOfDocument: () => null,
    changeDocumentLanguage: () => {
        throw new Error("editor layout unavailable");
    },
    openTextDocument: () => Promise.resolve(null),
    closeTabs: () => Promise.resolve(false),
    closeGroups: () => Promise.resolve(false),
};
