import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { Disposable } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";
import { clampPositionToDocument } from "../../../editor/common/core/iPosition.ts";
import { createSelection } from "../../../editor/common/core/iSelection.ts";
import { DiffEditorPane2 } from "../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../../browser/parts/editor/iEditorPane.ts";
import { isTextEditorPane, TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import type { EditorGroup } from "../../services/editor/browser/editorGroupModel.ts";
import { ACTIVE_GROUP, columnToEditorGroup } from "../../services/editor/common/editorGroupColumn.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IEditorLayoutService } from "../common/iEditorLayoutService.ts";
import type {
    IWireCloseGroupsParams,
    IWireCloseTabsParams,
    IWireCreateUntitledParams,
    IWireEditorLayout,
    IWireSelection,
    IWireShowTextDocumentParams,
    IWireShowTextDocumentResult,
    IWireTabGroupSnapshot,
    IWireTabSnapshot,
    IWireUriParams,
} from "../common/wireTypes.ts";

/**
 * Реализация {@link IEditorLayoutService} поверх полосы групп `IEditorService`:
 * снимки для `editor.layoutChanged` (коалесинг per-microtask), исполнение
 * `showTextDocument` (семантика `ViewColumn`: Active/Beside/1..9 с догоняющим
 * созданием хвостовых групп — AS-5) и закрытий из `window.tabGroups`.
 */
export class EditorLayoutServiceAdapter extends Disposable implements IEditorLayoutService {
    private readonly onDidChangeLayoutEmitter = this.register(new Emitter<IWireEditorLayout>());
    private flushScheduled = false;
    private pendingLayout = false;

    public constructor(
        private readonly editors: IEditorService,
        private readonly groups: IEditorGroupsService,
    ) {
        super();
        this.register(
            groups.onDidGroupsChange(() => {
                this.scheduleLayoutPush();
            }),
        );
        this.register(
            groups.onDidActiveGroupChange(() => {
                this.scheduleLayoutPush();
            }),
        );
        // Смена вкладок/меток/dirty — агрегатное событие фасада.
        this.register(
            editors.onDidChangeEditors(() => {
                this.scheduleLayoutPush();
            }),
        );
    }

    public getLayoutSnapshot(): IWireEditorLayout {
        const groups = this.groups.groups.map((group) => this.snapshotGroup(group));
        return { groups };
    }

    public readonly onDidChangeLayout = this.onDidChangeLayoutEmitter.event;

    public flushPendingLayout(): void {
        if (!this.pendingLayout) return;
        this.pendingLayout = false;
        const layout = this.getLayoutSnapshot();
        this.onDidChangeLayoutEmitter.fire(layout);
    }

    public async showTextDocument(params: IWireShowTextDocumentParams): Promise<IWireShowTextDocumentResult> {
        const uri = Uri.parse(params.uri);
        const focus = params.preserveFocus !== true;
        const previousActive = this.groups.activeGroup;
        const target = columnToEditorGroup(this.groups, params.viewColumn ?? ACTIVE_GROUP);

        // Открытие в конкретной группе: активируем её (без фокуса при
        // preserveFocus) и открываем ресурс фасадом — дедуп пер-группный. Уже
        // активная группа — no-op полосы.
        this.groups.focusGroup(target.id, { focus: false });
        // Ждём открытия: недисковый ресурс (`jdt:`) приезжает от провайдера
        // схемы обещанием, и выделение из `params` надо ставить уже в него.
        await this.editors.openUri(uri, { focus });

        const opened = this.groups.activeGroup;
        const editor = opened.activePane;
        if (isTextEditorPane(editor) && params.selection !== undefined) {
            const s = params.selection;
            // Позиции приехали от расширения и про наш текст ничего не знают:
            // `showTextDocument` со ставшей неверной позицией (устаревший индекс
            // символов, чужая ревизия файла) ставил каретку за конец строки, а
            // это падение первого же кадра на highlight вхождений. Кламп — как у
            // выделений через `editor.selections` в соседнем адаптере.
            const doc = editor.model.document;
            const anchor = clampPositionToDocument(doc, { line: s.anchorLine, character: s.anchorCharacter });
            const active = clampPositionToDocument(doc, { line: s.activeLine, character: s.activeCharacter });
            editor.viewState.selections = [
                createSelection(anchor.line, anchor.character, active.line, active.character),
            ];
            editor.revealRange({ start: active, end: active });
        }

        // preserveFocus: документ открыт в целевой колонке, но активная группа
        // (и фокус) остаются прежними — семантика VS Code. Группа не менялась —
        // no-op полосы.
        if (!focus) this.groups.focusGroup(previousActive.id, { focus: false });

        // Ответ обязан уехать ПОСЛЕ layoutChanged — флашит хост перед reply.
        return Promise.resolve({
            /* v8 ignore start -- openUri всегда вставляет и активирует вкладку: activePane тут не бывает null */
            uri: editor?.uri.toString() ?? params.uri,
            /* v8 ignore stop */
            groupId: opened.id,
            viewColumn: this.groups.viewColumnOf(opened),
        });
    }

    public createUntitledDocument(params: IWireCreateUntitledParams): IWireUriParams {
        const uri = this.editors.createUntitled({
            content: params.content,
            languageId: params.language,
            encoding: params.encoding,
        });
        return { uri: uri.toString() };
    }

    /**
     * Программное закрытие вкладок — тот же confirm-флоу, что у пользователя
     * (upstream `MainThreadEditorTabs.$closeTab`): цели собираются по группам,
     * каждая группа закрывается одной серией, ответ — `true`, если закрыто всё.
     * Вкладка или группа, которой уже нет, — идемпотентный успех.
     */
    public async closeTabs(params: IWireCloseTabsParams): Promise<boolean> {
        const targets: { group: EditorGroup; pane: IEditorPane }[] = [];
        for (const target of params.tabs) {
            const group = this.groups.groups.find((candidate) => candidate.id === target.groupId);
            if (group === undefined) continue;
            const pane = group.getPane(group.findPaneIndex(Uri.parse(target.uri)));
            if (pane !== null) targets.push({ group, pane });
        }
        let allClosed = true;
        for (const [group, entries] of Map.groupBy(targets, (entry) => entry.group)) {
            const panes = entries.map((entry) => entry.pane);
            if (!(await this.editors.closeEditors(group, panes))) allClosed = false;
        }
        return allClosed;
    }

    /**
     * Закрывает группы целиком (upstream `$closeGroup`): вето в одной группе не
     * мешает закрыть остальные, ответ — `true`, если закрыты все. Опустевшая
     * группа схлопывается сама.
     */
    public async closeGroups(params: IWireCloseGroupsParams): Promise<boolean> {
        let allClosed = true;
        for (const groupId of params.groupIds) {
            const group = this.groups.groups.find((candidate) => candidate.id === groupId);
            if (group === undefined) continue;
            if (!(await this.editors.closeAllEditors(group))) allClosed = false;
        }
        return allClosed;
    }

    // ─── Снимки ──────────────────────────────────────────────────────────────

    private scheduleLayoutPush(): void {
        this.pendingLayout = true;
        if (this.flushScheduled) return;
        this.flushScheduled = true;
        queueMicrotask(() => {
            this.flushScheduled = false;
            this.flushPendingLayout();
        });
    }

    private snapshotGroup(group: EditorGroup): IWireTabGroupSnapshot {
        return {
            groupId: group.id,
            viewColumn: this.groups.viewColumnOf(group),
            isActive: group === this.groups.activeGroup,
            tabs: group.getPanes().map((pane) => this.snapshotTab(group, pane)),
        };
    }

    private snapshotTab(group: EditorGroup, pane: IEditorPane): IWireTabSnapshot {
        const isActive = pane === group.activePane;
        const base = {
            uri: pane.uri.toString(),
            label: pane.label,
            isActive,
            isDirty: pane.isModified,
        };
        if (pane instanceof DiffEditorPane2) {
            return {
                ...base,
                kind: "diff",
                ...(pane.originalUri !== null ? { original: pane.originalUri.toString() } : {}),
                ...(pane.modifiedUri !== null ? { modified: pane.modifiedUri.toString() } : {}),
            };
        }
        // Вкладка не текстового и не дифф-вида (Keyboard Shortcuts, страница
        // расширения) — `TabInputUnknown` у vscode: расширению она не «текстовый
        // редактор», и выдавать её за текст по её uri нельзя.
        if (!(pane instanceof TextEditorPane)) {
            return { ...base, kind: "unknown" };
        }
        return {
            ...base,
            kind: "text",
            languageId: pane.languageId,
            // Выделения — только у активной вкладки: это «видимый редактор»,
            // его selection сеется расширению из снимка.
            ...(isActive ? { selections: pane.viewState.selections.map(toWireSelection) } : {}),
        };
    }
}

function toWireSelection(selection: {
    anchor: { line: number; character: number };
    active: { line: number; character: number };
}): IWireSelection {
    return {
        anchorLine: selection.anchor.line,
        anchorCharacter: selection.anchor.character,
        activeLine: selection.active.line,
        activeCharacter: selection.active.character,
    };
}
