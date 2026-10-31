import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import {
    cursorStyleFromApi,
    type EditorCursorStyleSetting,
} from "../../../../../editor/common/config/editorCursorStyle.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IEditorLayoutService } from "../../../../api/common/iEditorLayoutService.ts";
import type {
    IEditorOptionsPatch,
    IEditorOptionsService,
    IEditorOptionsState,
} from "../../../../api/common/iEditorOptionsService.ts";
import {
    type IWireSaveResult,
    type IWireShowTextDocumentResult,
    parseWireSelections,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireApplyWorkspaceEditParams,
    parseWireCloseGroupsParams,
    parseWireCloseTabsParams,
    parseWireCreateUntitledParams,
    parseWireEditorEdits,
    parseWireShowTextDocumentParams,
} from "../hostWireParsers.ts";

export class EditorCustomer implements IExtensionHostCustomer {
    private rpc: HostRpc | null = null;

    public constructor(
        private readonly editorOptions: IEditorOptionsService,
        private readonly editorLayout: IEditorLayoutService,
    ) {}

    /**
     * The group strip goes BEFORE the active editor meta: the stock languageclient reads
     * `visibleTextEditors`/`tabGroups` on start().
     */
    public pushInitialState(): void {
        this.rpc?.notify("editor.layoutChanged", this.editorLayout.getLayoutSnapshot());
        this.rpc?.notify("editor.activeEditorChanged", this.editorOptions.getActiveEditorMeta());
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        this.rpc = rpc;
        const store = new DisposableStore();
        store.add(
            rpc.handleRequest("editor.setOptions", (params): null => {
                const patch = sanitizeOptionsPatch(params);
                this.editorOptions.setActiveEditorOptions(patch);
                const cursorStyle = parseCursorStyleTarget(params);
                if (cursorStyle !== null) {
                    this.editorOptions.setEditorCursorStyle(cursorStyle.uri, cursorStyle.groupId, cursorStyle.style);
                }
                return null;
            }),
        );
        store.add(
            rpc.handleRequest("editor.getOptions", (): IEditorOptionsState | null => {
                return this.editorOptions.getActiveEditorOptions();
            }),
        );
        // Fire-and-forget for the extension, but in arrival order — before a subsequent executeCommand.
        store.add(
            rpc.handleNotification("editor.setSelection", (params): void => {
                const p: { uri?: unknown; selections?: unknown; groupId?: unknown } = params;
                if (typeof p.uri !== "string") return;
                this.editorOptions.setActiveEditorSelections(
                    p.uri,
                    parseWireSelections(p.selections),
                    typeof p.groupId === "number" ? p.groupId : undefined,
                );
            }),
        );
        store.add(
            rpc.handleRequest("editor.applyEdit", (params): boolean => {
                const p: { uri?: unknown; edits?: unknown; version?: unknown; setEndOfLine?: unknown } = params;
                if (typeof p.uri !== "string") return false;
                return this.editorOptions.applyActiveEditorEdits(p.uri, parseWireEditorEdits(p.edits), {
                    ...(typeof p.version === "number" ? { version: p.version } : {}),
                    ...(p.setEndOfLine === 1 || p.setEndOfLine === 2 ? { setEndOfLine: p.setEndOfLine } : {}),
                });
            }),
        );
        // Garbage in params is an honest `false`, not a partial edit.
        store.add(
            rpc.handleRequest("workspace.applyEdit", async (params): Promise<boolean> => {
                const ops = parseWireApplyWorkspaceEditParams(params);
                if (ops === null) return false;
                return this.editorOptions.applyWorkspaceEdit(ops, { isRefactoring: params.isRefactoring === true });
            }),
        );
        // Upstream `$saveAll`/`$save`: golang.go saves everything before `gopls.tidy` and vulncheck.
        store.add(
            rpc.handleRequest("workspace.saveAll", (params): Promise<boolean> => {
                return this.editorOptions.saveAll(params.includeUntitled === true);
            }),
        );
        store.add(
            rpc.handleRequest("workspace.save", async (params): Promise<IWireSaveResult> => {
                const p: { uri?: unknown } = params;
                if (typeof p.uri !== "string") return null;
                const saved = await this.editorOptions.save(p.uri);
                return saved === null ? null : { uri: saved };
            }),
        );
        // Invariant: layoutChanged comes before the related activeEditorChanged — the layout subscription goes first,
        // and the meta flushes the deferred snapshot so `visibleTextEditors` doesn't lag behind `activeTextEditor`.
        store.add(
            this.editorLayout.onDidChangeLayout((layout) => {
                rpc.notify("editor.layoutChanged", layout);
            }),
        );
        // The reply goes out AFTER layoutChanged: after `await` the extension sees fresh `tabGroups`.
        store.add(
            rpc.handleRequest("editor.showTextDocument", async (params): Promise<IWireShowTextDocumentResult> => {
                const parsed = parseWireShowTextDocumentParams(params);
                if (parsed === null) throw new Error("editor.showTextDocument: malformed params");
                const result = await this.editorLayout.showTextDocument(parsed);
                this.editorLayout.flushPendingLayout();
                return result;
            }),
        );
        // `editor.didOpen` goes out synchronously during opening — the reply doesn't overtake it.
        store.add(
            rpc.handleRequest("workspace.openTextDocument", (params) =>
                this.editorLayout.openTextDocument({ uri: params.uri }),
            ),
        );
        // `editor.didOpen` goes out synchronously during creation — the reply doesn't overtake it.
        store.add(
            rpc.handleRequest("workspace.createUntitledDocument", (params) =>
                this.editorLayout.createUntitledDocument(parseWireCreateUntitledParams(params)),
            ),
        );
        store.add(
            rpc.handleRequest("editor.closeTabs", async (params): Promise<boolean> => {
                const parsed = parseWireCloseTabsParams(params);
                if (parsed === null) throw new Error("editor.closeTabs: malformed params");
                const result = await this.editorLayout.closeTabs(parsed);
                this.editorLayout.flushPendingLayout();
                return result;
            }),
        );
        store.add(
            rpc.handleRequest("editor.closeGroups", async (params): Promise<boolean> => {
                const parsed = parseWireCloseGroupsParams(params);
                if (parsed === null) throw new Error("editor.closeGroups: malformed params");
                const result = await this.editorLayout.closeGroups(parsed);
                this.editorLayout.flushPendingLayout();
                return result;
            }),
        );
        store.add(
            this.editorOptions.onActiveEditorChanged((meta) => {
                this.editorLayout.flushPendingLayout();
                rpc.notify("editor.activeEditorChanged", meta);
            }),
        );
        // A separate message rather than `activeEditorChanged`: that one fires `onDidChangeActiveTextEditor`,
        // and the built-in git would recompute status on every arrow key press.
        store.add(
            this.editorOptions.onActiveEditorSelectionChanged((selections) => {
                rpc.notify("editor.selectionChanged", selections);
            }),
        );
        store.add({
            dispose: () => {
                this.rpc = null;
            },
        });
        return store;
    }
}

function sanitizeOptionsPatch(raw: unknown): IEditorOptionsPatch {
    if (typeof raw !== "object" || raw === null) return {};
    const obj = raw as { tabSize?: unknown; insertSpaces?: unknown; indentSize?: unknown };
    const patch: { tabSize?: number; insertSpaces?: boolean } = {};
    if (isFiniteNumber(obj.tabSize) && obj.tabSize > 0) {
        patch.tabSize = Math.floor(obj.tabSize);
    }
    // `indentSize` is an alias of tabSize (Diode doesn't distinguish them yet): applied only
    // when there is no explicit tabSize. editorconfig sends indent_size exactly this way.
    if (patch.tabSize === undefined && isFiniteNumber(obj.indentSize) && obj.indentSize > 0) {
        patch.tabSize = Math.floor(obj.indentSize);
    }
    if (typeof obj.insertSpaces === "boolean") {
        patch.insertSpaces = obj.insertSpaces;
    }
    return patch;
}

/** `null` unless the style is 1..6 and the editor is addressed by uri and group. */
function parseCursorStyleTarget(
    raw: unknown,
): { readonly uri: string; readonly groupId: number; readonly style: EditorCursorStyleSetting } | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as { cursorStyle?: unknown; uri?: unknown; groupId?: unknown };
    const style = cursorStyleFromApi(obj.cursorStyle);
    if (style === undefined || typeof obj.uri !== "string" || typeof obj.groupId !== "number") return null;
    return { uri: obj.uri, groupId: obj.groupId, style };
}

function isFiniteNumber(value: unknown): value is number {
    return Number.isFinite(value);
}
