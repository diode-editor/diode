import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
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
     * Полоса групп — ДО меты активного редактора: стоковый languageclient читает
     * `visibleTextEditors`/`tabGroups` на start().
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
                return null;
            }),
        );
        store.add(
            rpc.handleRequest("editor.getOptions", (): IEditorOptionsState | null => {
                return this.editorOptions.getActiveEditorOptions();
            }),
        );
        // Fire-and-forget у расширения, но в порядке прихода — до последующего executeCommand.
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
                const p: { uri?: unknown; edits?: unknown } = params;
                if (typeof p.uri !== "string") return false;
                return this.editorOptions.applyActiveEditorEdits(p.uri, parseWireEditorEdits(p.edits));
            }),
        );
        // Мусор в параметрах — честный `false`, а не частичный edit.
        store.add(
            rpc.handleRequest("workspace.applyEdit", async (params): Promise<boolean> => {
                const ops = parseWireApplyWorkspaceEditParams(params);
                if (ops === null) return false;
                return this.editorOptions.applyWorkspaceEdit(ops, { isRefactoring: params.isRefactoring === true });
            }),
        );
        // `$saveAll`/`$save` эталона: golang.go сохраняет всё перед `gopls.tidy` и vulncheck.
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
        // Инвариант: layoutChanged раньше связанного activeEditorChanged — подписка на layout первая,
        // а мета флашит отложенный снимок, чтобы `visibleTextEditors` не отставал от `activeTextEditor`.
        store.add(
            this.editorLayout.onDidChangeLayout((layout) => {
                rpc.notify("editor.layoutChanged", layout);
            }),
        );
        // Ответ уезжает ПОСЛЕ layoutChanged: после `await` расширение видит свежий `tabGroups`.
        store.add(
            rpc.handleRequest("editor.showTextDocument", async (params): Promise<IWireShowTextDocumentResult> => {
                const parsed = parseWireShowTextDocumentParams(params);
                if (parsed === null) throw new Error("editor.showTextDocument: malformed params");
                const result = await this.editorLayout.showTextDocument(parsed);
                this.editorLayout.flushPendingLayout();
                return result;
            }),
        );
        // `editor.didOpen` уходит синхронно внутри создания — ответ его не обгоняет.
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
        // Отдельное сообщение, а не `activeEditorChanged`: тот дёргает `onDidChangeActiveTextEditor`,
        // и встроенный git пересчитывал бы статус на каждое нажатие стрелки.
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
    // `indentSize` — алиас tabSize (Diode пока не различает их): применяем только
    // если явного tabSize нет. editorconfig шлёт indent_size именно так.
    if (patch.tabSize === undefined && isFiniteNumber(obj.indentSize) && obj.indentSize > 0) {
        patch.tabSize = Math.floor(obj.indentSize);
    }
    if (typeof obj.insertSpaces === "boolean") {
        patch.insertSpaces = obj.insertSpaces;
    }
    return patch;
}

function isFiniteNumber(value: unknown): value is number {
    return Number.isFinite(value);
}
