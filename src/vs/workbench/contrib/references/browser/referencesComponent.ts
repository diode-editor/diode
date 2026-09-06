import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { Uri } from "../../../../base/common/uri.ts";
import { createRange, type IRange } from "../../../../editor/common/core/iRange.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import { HeaderBodyViewElement } from "../../../browser/parts/views/headerBodyViewElement.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { ITextMatch } from "../../../services/search/common/textSearch.ts";
import {
    buildFileRow,
    buildMatchRow,
    type ISearchRowStyles,
} from "../../search/browser/searchResultRows.ts";

import type { IReferenceGroup } from "./referencePreview.ts";

export const ReferencesComponentDIToken = token<ReferencesComponent>("ReferencesComponent");

/** Контейнер сайдбара (вьюлет) и его единственная view — id как у VS Code. */
export const REFERENCES_VIEWLET_ID = "references-view";
export const REFERENCES_VIEW_ID = "references-view.tree";

/** Редактор, в котором раскрывается позиция ссылки. */
export interface IReferencesRevealEditor {
    goToPosition(line: number, column?: number): void;
    revealRange(range: IRange): void;
}

/**
 * Минимальный срез группы редакторов для открытия ссылки: открыть файл и
 * довести до позиции. `EditorService` соответствует ему структурно —
 * связывание делает DI-модуль (как {@link import("../../search/browser/searchComponent.ts").SearchRevealTargetDIToken}).
 */
export interface IReferencesRevealTarget {
    openUri(uri: Uri): void;
    getActiveEditor(): IReferencesRevealEditor | null;
}

export const ReferencesRevealTargetDIToken = token<IReferencesRevealTarget>("ReferencesRevealTarget");

/** Метаданные строки списка — для активации и обхода по F4. */
type RowMeta =
    | { readonly kind: "file"; readonly group: IReferenceGroup }
    | { readonly kind: "reference"; readonly group: IReferenceGroup; readonly match: ITextMatch };

function fileRowId(group: IReferenceGroup): string {
    return `file:${group.relPath}`;
}

function referenceRowId(group: IReferenceGroup, index: number): string {
    return `ref:${group.relPath}:${String(index)}`;
}

/**
 * Вьюлет REFERENCES (левый сайдбар) — результат Find All References: файлы со
 * счётчиком ссылок, под каждым — строки кода с подсвеченным вхождением. Enter
 * или двойной клик открывает файл на позиции ссылки (шов
 * {@link IReferencesRevealTarget}), F4/Shift+F4 обходят ссылки не уводя фокус
 * из редактора.
 *
 * Живёт как merged одно-view контейнер ({@link ViewsService}): заголовок
 * `REFERENCES` с меню «⋯» рисует PaneHeaderElement, тело — шапка со счётчиком
 * плюс список ({@link HeaderBodyViewElement}). Строки — общие с панелью поиска
 * ({@link buildFileRow}/{@link buildMatchRow}): «файл + строки с подсветкой» у
 * нас ровно одна визуальная идиома, и расходиться ей незачем.
 *
 * Наполняет вьюлет `ReferencesService`; сам компонент про LSP не знает.
 */
export class ReferencesComponent extends Component {
    public static dependencies = [
        ReferencesRevealTargetDIToken,
        ContextKeyServiceDIToken,
        ViewsServiceDIToken,
        JumpRecorderDIToken,
    ] as const;

    private readonly root: HeaderBodyViewElement;
    private readonly countLabel = new TextLabelElement("");
    private readonly scrollBars: ScrollBarDecorator;
    /** Список результатов; публичный — тесты и команды ходят в него напрямую, как в Search. */
    public readonly results = new ListViewElement({ typeahead: false });

    private groups: readonly IReferenceGroup[] = [];
    private rowMeta = new Map<string, RowMeta>();
    private rowParents = new Map<string, string | null>();
    /** Порядок строк-ссылок — обход по F4 идёт по нему, а не по проекции списка. */
    private referenceRowIds: string[] = [];
    private referenceCount = 0;
    /** Был ли уже поиск: до него шапка пуста, после — счётчик или «No results». */
    private searched = false;

    public constructor(
        private readonly revealTarget: IReferencesRevealTarget,
        private readonly contextKeys: ContextKeyService,
        viewsService: ViewsService,
        private readonly jumps: IJumpRecorder,
    ) {
        super();

        this.results.id = "referenceResults";
        this.results.onActivate = (element) => {
            // Список не принимает строки без id — здесь он гарантированно есть.
            this.activateRow(element.id!);
        };
        this.results.onCollapsedChanged = () => {
            this.refreshResultKeys();
        };
        this.refreshResultKeys();
        this.scrollBars = new ScrollBarDecorator(this.results);

        // Счётчик не прижат к краю панели — отступ по колонке слева и справа,
        // как у шапки поиска.
        const paddedHeader = new PaddingContainerElement(this.countLabel, { left: 1, right: 1 });
        this.root = new HeaderBodyViewElement(paddedHeader, this.scrollBars);
        this.root.id = "referencesView";
        this.root.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.countLabel.setColors("descriptionForeground", INHERITED_BG);
        this.updateCount();

        viewsService.registerView({
            id: REFERENCES_VIEW_ID,
            containerId: REFERENCES_VIEWLET_ID,
            title: "REFERENCES",
            order: 10,
            body: this.root,
            focus: () => {
                this.focus();
            },
        });
    }

    public get view(): TUIElement {
        return this.root;
    }

    /** Фокус в список (вьюлет показан командой). */
    public focus(): void {
        this.results.focus();
    }

    /**
     * Показывает результат нового поиска: строки пересобираются, курсор встаёт
     * на первую ссылку. Пустой список — валидный результат («No results» в
     * шапке), а не повод оставить старые ссылки на экране.
     */
    public setResults(groups: readonly IReferenceGroup[]): void {
        this.searched = true;
        this.groups = groups;
        this.referenceCount = groups.reduce((sum, group) => sum + group.matches.length, 0);
        this.rebuildRows();
        this.updateCount();
        this.refreshResultKeys();
    }

    /** Очищает панель (команда Clear и смена воркспейса). */
    public clear(): void {
        this.searched = false;
        this.groups = [];
        this.referenceCount = 0;
        this.rebuildRows();
        this.updateCount();
        this.refreshResultKeys();
    }

    /** Сколько ссылок сейчас в панели (читают команды и тесты). */
    public get resultCount(): number {
        return this.referenceCount;
    }

    /**
     * Collapse All: сворачивает все файл-строки. Уровень тут один (файлы →
     * ссылки), поэтому поэтапности VS Code, как в поиске с деревом каталогов,
     * не требуется.
     */
    public collapseDeepestLevel(): void {
        for (const [id, meta] of this.rowMeta) {
            if (meta.kind === "file") this.results.setCollapsed(id, true);
        }
        this.refreshResultKeys();
    }

    /** Expand All — развернуть все свёрнутые строки. */
    public expandAll(): void {
        for (const id of this.results.getCollapsedIds()) {
            this.results.setCollapsed(id, false);
        }
        this.refreshResultKeys();
    }

    /**
     * F4 — следующая ссылка: курсор списка переезжает на неё и редактор
     * открывается на позиции. Обход идёт по всем файлам подряд и заворачивается
     * с последней на первую (VS Code: references-view.next).
     */
    public goToNextReference(): void {
        this.stepReference(1);
    }

    /** Shift+F4 — предыдущая ссылка; с первой заворачивается на последнюю. */
    public goToPreviousReference(): void {
        this.stepReference(-1);
    }

    private stepReference(delta: number): void {
        if (this.referenceRowIds.length === 0) return;
        const cursorId = this.results.getCursorElement()?.id ?? null;
        const current = cursorId === null ? -1 : this.referenceRowIds.indexOf(cursorId);
        // Курсор на файл-строке (или его нет вовсе) — шаг «вперёд» ведёт на
        // первую ссылку, «назад» — на последнюю.
        const base = current === -1 ? (delta > 0 ? -1 : 0) : current;
        const count = this.referenceRowIds.length;
        const next = (((base + delta) % count) + count) % count;
        const id = this.referenceRowIds[next];
        // Строка могла оказаться под свёрнутым файлом — раскрываем, иначе
        // курсор уедет в невидимое.
        const parent = this.rowParents.get(id);
        if (parent != null) this.results.setCollapsed(parent, false);
        this.results.setCursorTo(id);
        this.activateRow(id);
    }

    private rebuildRows(): void {
        this.results.clear();
        this.rowMeta.clear();
        this.rowParents.clear();
        this.referenceRowIds = [];

        for (const group of this.groups) {
            const fileId = fileRowId(group);
            const fileElement = buildFileRow(fileId, group.relPath, group.matches.length, ROW_STYLES);
            this.rowMeta.set(fileId, { kind: "file", group });
            this.rowParents.set(fileId, null);
            this.results.appendRow(fileElement, { label: group.relPath });

            group.matches.forEach((match, index) => {
                const id = referenceRowId(group, index);
                const element = buildMatchRow(id, match, ROW_STYLES);
                this.rowMeta.set(id, { kind: "reference", group, match });
                this.rowParents.set(id, fileId);
                this.referenceRowIds.push(id);
                this.results.appendRow(element, { parentId: fileId });
            });
        }

        const first = this.referenceRowIds[0];
        if (first !== undefined) this.results.setCursorTo(first);
    }

    /** Enter/двойной клик: файл сворачивается, ссылка открывается на позиции. */
    private activateRow(rowId: string): void {
        const meta = this.rowMeta.get(rowId);
        /* v8 ignore start -- defensive: every appended row has meta under its id */
        if (meta === undefined) return;
        /* v8 ignore stop */
        if (meta.kind === "file") {
            this.results.toggleCollapsed(rowId);
            this.refreshResultKeys();
            return;
        }
        // Переход целиком — одна запись истории (см. IJumpRecorder).
        this.jumps.jump(() => {
            this.revealTarget.openUri(Uri.file(meta.group.absolutePath));
            const editor = this.revealTarget.getActiveEditor();
            if (editor === null) return;
            // lineNumber строки списка 1-based, редактор ждёт 0-based.
            const line = meta.match.lineNumber - 1;
            editor.goToPosition(line, meta.match.startColumn);
            editor.revealRange(createRange(line, meta.match.startColumn, line, meta.match.endColumn));
        });
    }

    private updateCount(): void {
        this.countLabel.setText(this.countText());
        this.countLabel.markDirty();
    }

    /** Счётчик в шапке — та же формулировка, что у панели поиска. */
    private countText(): string {
        if (!this.searched) return "";
        if (this.referenceCount === 0) return "No results";
        const files = this.groups.length === 1 ? "file" : "files";
        return `${String(this.referenceCount)} results in ${String(this.groups.length)} ${files}`;
    }

    private refreshResultKeys(): void {
        this.contextKeys.set("hasReferenceResult", this.referenceCount > 0);
        this.contextKeys.set("referencesViewHasSomeCollapsibleResult", this.results.hasVisibleExpandedRow());
    }
}

/** Цвета строк — те же токены, что у результатов поиска. */
const ROW_STYLES: ISearchRowStyles = {
    dimFg: "descriptionForeground",
    matchFg: "sideBar.foreground",
    matchBg: "editor.wordHighlightBackground",
};
