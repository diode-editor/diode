import type { IDisposable } from "@tuidom/core/common/disposable";
import { Disposable } from "@tuidom/core/common/disposable";

import { Uri } from "../../../base/common/uri.ts";
import { clampPositionToDocument } from "../../../editor/common/core/iPosition.ts";
import { createSelection } from "../../../editor/common/core/iSelection.ts";
import { DiffEditorPane2 } from "../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../../browser/parts/editor/iEditorPane.ts";
import { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import type { EditorGroup } from "../../services/editor/browser/editorGroupModel.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";
import type { IEditorLayoutService } from "../common/iEditorLayoutService.ts";
import type {
    IWireCloseGroupsParams,
    IWireCloseTabsParams,
    IWireEditorLayout,
    IWireSelection,
    IWireShowTextDocumentParams,
    IWireShowTextDocumentResult,
    IWireTabGroupSnapshot,
    IWireTabSnapshot,
} from "../common/wireTypes.ts";

/** `vscode.ViewColumn.Active` — символическая «текущая колонка». */
const VIEW_COLUMN_ACTIVE = -1;
/** `vscode.ViewColumn.Beside` — колонка справа от активной. */
const VIEW_COLUMN_BESIDE = -2;

/**
 * Реализация {@link IEditorLayoutService} поверх полосы групп `EditorService`:
 * снимки для `editor.layoutChanged` (коалесинг per-microtask), исполнение
 * `showTextDocument` (семантика `ViewColumn`: Active/Beside/1..9 с догоняющим
 * созданием хвостовых групп — AS-5) и закрытий из `window.tabGroups`.
 */
export class EditorLayoutServiceAdapter extends Disposable implements IEditorLayoutService {
    private layoutListeners: ((layout: IWireEditorLayout) => void)[] = [];
    private flushScheduled = false;
    private pendingLayout = false;

    public constructor(private readonly editors: EditorService) {
        super();
        this.register(
            editors.onDidGroupsChange(() => {
                this.scheduleLayoutPush();
            }),
        );
        this.register(
            editors.onDidActiveGroupChange(() => {
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
        const groups = this.editors.groups.map((group) => this.snapshotGroup(group));
        return { groups };
    }

    public onDidChangeLayout(cb: (layout: IWireEditorLayout) => void): IDisposable {
        this.layoutListeners.push(cb);
        return {
            dispose: () => {
                const idx = this.layoutListeners.indexOf(cb);
                if (idx >= 0) this.layoutListeners.splice(idx, 1);
            },
        };
    }

    public flushPendingLayout(): void {
        if (!this.pendingLayout) return;
        this.pendingLayout = false;
        const layout = this.getLayoutSnapshot();
        for (const cb of [...this.layoutListeners]) cb(layout);
    }

    public async showTextDocument(params: IWireShowTextDocumentParams): Promise<IWireShowTextDocumentResult> {
        const uri = Uri.parse(params.uri);
        const focus = params.preserveFocus !== true;
        const previousActive = this.editors.activeGroup;
        const target = this.resolveTargetGroup(params.viewColumn ?? VIEW_COLUMN_ACTIVE);

        // Открытие в конкретной группе: активируем её (без фокуса при
        // preserveFocus) и открываем ресурс фасадом — дедуп пер-группный.
        if (target !== this.editors.activeGroup) {
            this.editors.focusGroup(target.id, { focus: false });
        }
        // Ждём открытия: недисковый ресурс (`jdt:`) приезжает от провайдера
        // схемы обещанием, и выделение из `params` надо ставить уже в него.
        await this.editors.openUri(uri, { focus });

        const opened = this.editors.activeGroup;
        const editor = opened.activePane;
        if (editor instanceof TextEditorPane && params.selection !== undefined) {
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
        // (и фокус) остаются прежними — семантика VS Code.
        if (!focus && this.editors.activeGroup !== previousActive) {
            this.editors.focusGroup(previousActive.id, { focus: false });
        }

        // Ответ обязан уехать ПОСЛЕ layoutChanged — флашит хост перед reply.
        return Promise.resolve({
            /* v8 ignore start -- openUri всегда вставляет и активирует вкладку: activePane тут не бывает null */
            uri: editor?.uri.toString() ?? params.uri,
            /* v8 ignore stop */
            groupId: opened.id,
            viewColumn: this.editors.viewColumnOf(opened),
        });
    }

    /**
     * Программное закрытие вкладок — тот же confirm-флоу, что у пользователя
     * (upstream `MainThreadEditorTabs.$closeTab`): цели собираются по группам,
     * каждая группа закрывается одной серией, ответ — `true`, если закрыто всё.
     * Вкладка или группа, которой уже нет, — идемпотентный успех.
     */
    public async closeTabs(params: IWireCloseTabsParams): Promise<boolean> {
        const targets = new Map<EditorGroup, IEditorPane[]>();
        for (const target of params.tabs) {
            const group = this.editors.groups.find((candidate) => candidate.id === target.groupId);
            if (group === undefined) continue;
            const pane = group.getPane(group.findPaneIndex(Uri.parse(target.uri)));
            if (pane === null) continue;
            targets.set(group, [...(targets.get(group) ?? []), pane]);
        }
        const results: boolean[] = [];
        for (const [group, panes] of targets) results.push(await this.editors.closeEditors(group, panes));
        return results.every((closed) => closed);
    }

    /**
     * Закрывает группы целиком (upstream `$closeGroup`): вето в одной группе не
     * мешает закрыть остальные, ответ — `true`, если закрыты все. Опустевшая
     * группа схлопывается сама.
     */
    public async closeGroups(params: IWireCloseGroupsParams): Promise<boolean> {
        const results: boolean[] = [];
        for (const groupId of params.groupIds) {
            const group = this.editors.groups.find((candidate) => candidate.id === groupId);
            if (group === undefined) continue;
            results.push(await this.editors.closeAllEditors(group));
        }
        return results.every((closed) => closed);
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
            viewColumn: this.editors.viewColumnOf(group),
            isActive: group === this.editors.activeGroup,
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
        /* v8 ignore start -- в полосе только текстовые и дифф-вкладки; минимальный снимок — задел под будущие виды панелей */
        if (!(pane instanceof TextEditorPane)) {
            return { ...base, kind: "text" };
        }
        /* v8 ignore stop */
        return {
            ...base,
            kind: "text",
            languageId: pane.languageId,
            // Выделения — только у активной вкладки: это «видимый редактор»,
            // его selection сеется расширению из снимка.
            ...(isActive ? { selections: pane.viewState.selections.map(toWireSelection) } : {}),
        };
    }

    /**
     * Резолв `ViewColumn` в группу: Active — активная; Beside — сосед справа
     * (создаётся при отсутствии); 1..9 — по позиции, за краем — догоняющее
     * создание хвостовых групп (AS-5; отказ по месту оставляет последнюю).
     */
    private resolveTargetGroup(viewColumn: number): EditorGroup {
        if (viewColumn === VIEW_COLUMN_ACTIVE) return this.editors.activeGroup;
        if (viewColumn === VIEW_COLUMN_BESIDE) {
            const index = this.editors.groups.indexOf(this.editors.activeGroup);
            return (
                this.editors.groups.at(index + 1) ??
                this.editors.newGroup("after", { focus: false }) ??
                this.editors.activeGroup
            );
        }
        const wanted = Math.max(1, Math.floor(viewColumn));
        while (this.editors.groups.length < wanted) {
            const before = this.editors.groups.length;
            this.editors.focusGroup({ index: before - 1 }, { focus: false });
            if (this.editors.newGroup("after", { focus: false }) === null) break; // не влезло — фолбэк в край
            /* v8 ignore start -- защитный выход от зацикливания при неожиданном no-op */
            if (this.editors.groups.length === before) break;
            /* v8 ignore stop */
        }
        return this.editors.groups[Math.min(wanted, this.editors.groups.length) - 1];
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
