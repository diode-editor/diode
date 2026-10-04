import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IEditorLayoutService } from "../../../../api/common/iEditorLayoutService.ts";
import type {
    IEditorOptionsPatch,
    IEditorOptionsService,
    IEditorOptionsState,
} from "../../../../api/common/iEditorOptionsService.ts";
import { type IWireShowTextDocumentResult, parseWireSelections } from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireApplyWorkspaceEditParams,
    parseWireCloseGroupsParams,
    parseWireCloseTabsParams,
    parseWireEditorEdits,
    parseWireShowTextDocumentParams,
} from "../hostWireParsers.ts";

/**
 * Редакторы для расширений: опции и выделения активного редактора, правки
 * `TextEditor.edit` и `workspace.applyEdit`, полоса групп (`tabGroups`,
 * `visibleTextEditors`) и `window.showTextDocument`. Подписки на ядро живут
 * один спавн; семена полосы и активного редактора хост шлёт на своём месте
 * последовательности handshake ({@link pushInitialState}).
 */
export class EditorCustomer implements IExtensionHostCustomer {
    /** Канал текущего спавна; `null` — спавна нет. */
    private rpc: HostRpc | null = null;

    public constructor(
        private readonly editorOptions: IEditorOptionsService,
        private readonly editorLayout: IEditorLayoutService,
    ) {}

    /**
     * Семена handshake: полоса групп — ДО меты активного редактора,
     * `visibleTextEditors`/`tabGroups` обязаны существовать к моменту активации
     * (стоковый languageclient читает их на start()); мета активного редактора —
     * чтобы `window.activeTextEditor` был верен до первой активации.
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
        // Сабпроцесс просит выставить выделения активного редактора
        // (`TextEditor.selection(s) =`). Fire-and-forget со стороны расширения,
        // но обрабатывается в порядке прихода (до последующего executeCommand).
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
        // Сабпроцесс просит применить правки `TextEditor.edit` одним undoable-батчем.
        store.add(
            rpc.handleRequest("editor.applyEdit", (params): boolean => {
                const p: { uri?: unknown; edits?: unknown } = params;
                if (typeof p.uri !== "string") return false;
                return this.editorOptions.applyActiveEditorEdits(p.uri, parseWireEditorEdits(p.edits));
            }),
        );
        // Сабпроцесс просит применить workspace edit (`workspace.applyEdit`):
        // текстовые правки по ресурсам плюс файловые операции, all-or-nothing
        // по валидации. Мусор в параметрах — честный `false`, а не частичный edit.
        store.add(
            rpc.handleRequest("workspace.applyEdit", async (params): Promise<boolean> => {
                const ops = parseWireApplyWorkspaceEditParams(params);
                if (ops === null) return false;
                return this.editorOptions.applyWorkspaceEdit(ops);
            }),
        );
        // Полоса групп: снимки по изменениям (коалесинг в адаптере). Инвариант
        // порядка: layoutChanged всегда раньше связанного activeEditorChanged —
        // подписка на layout стоит первой, а мета дополнительно флашит отложенный
        // снимок, чтобы `visibleTextEditors` не отставал от `activeTextEditor`.
        store.add(
            this.editorLayout.onDidChangeLayout((layout) => {
                rpc.notify("editor.layoutChanged", layout);
            }),
        );
        // `window.showTextDocument`: открыть/активировать ресурс в колонке;
        // ответ уезжает ПОСЛЕ layoutChanged (flush перед reply) — после `await`
        // расширение видит свежий `tabGroups`.
        store.add(
            rpc.handleRequest("editor.showTextDocument", async (params): Promise<IWireShowTextDocumentResult> => {
                const parsed = parseWireShowTextDocumentParams(params);
                if (parsed === null) throw new Error("editor.showTextDocument: malformed params");
                const result = await this.editorLayout.showTextDocument(parsed);
                this.editorLayout.flushPendingLayout();
                return result;
            }),
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
        // Движение каретки/смена выделения — отдельным сообщением, чтобы
        // `activeTextEditor.selection` в расширении не залипал на состоянии момента
        // открытия файла. Именно `activeEditorChanged` слать нельзя: он дёргает
        // `onDidChangeActiveTextEditor`, и, например, встроенный git пересчитывал бы
        // статус на каждое нажатие стрелки.
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

/** `Number.isFinite` не приводит типы: не-число — сразу `false`. */
function isFiniteNumber(value: unknown): value is number {
    return Number.isFinite(value);
}
