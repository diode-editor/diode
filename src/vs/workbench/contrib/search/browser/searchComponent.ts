import { BoxConstraints, Offset, Point, Rect, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { INHERITED_BG, INHERITED_FG } from "../../../../../../tuidom/dom/styles/tuiStyle.ts";
import { RenderContext, TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { InputElement } from "../../../../../../tuidom/ui/inputbox/inputElement.ts";
import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { PaddingContainerElement } from "../../../../../../tuidom/ui/layout/paddingContainerElement.ts";
import { VStackElement } from "../../../../../../tuidom/ui/layout/vStackElement.ts";
import { ListViewElement } from "../../../../../../tuidom/ui/list/listViewElement.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { Component } from "../../../browser/component.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { SEARCH_QUERY_DETAILS_STATE, SEARCH_VIEW_MODE_STATE, type SearchViewMode } from "../../../common/stateKeys.ts";
import type {
    IFileMatch,
    ISearchHandle,
    ITextMatch,
    ITextSearchQuery,
    ITextSearchService,
} from "../../../services/search/common/textSearch.ts";
import { TextSearchServiceDIToken } from "../../../services/search/common/textSearch.ts";
import type { ExplorerService } from "../../files/browser/explorerService.ts";
import { ExplorerServiceDIToken } from "../../files/browser/explorerService.ts";

import {
    buildFileRow,
    buildFolderRow,
    buildMatchRow,
    formatFileRow,
    formatMatchRow,
    type ISearchRowStyles,
} from "./searchResultRows.ts";
import { buildSearchTree, type SearchTreeNode } from "./searchResultTree.ts";

export const SearchComponentDIToken = token<SearchComponent>("SearchComponent");

/** Id вьюлета Search в сайдбаре (он же id merged-контейнера, см. `workbench.view.search`). */
export const SEARCH_VIEWLET_ID = "search";

/** Id единственной view merged-контейнера Search (контекст меню «⋯», конвенция SCM). */
export const SEARCH_VIEW_ID = "workbench.search.results";

/** Редактор, в котором раскрывается позиция результата поиска. */
export interface ISearchRevealEditor {
    goToPosition(line: number, column?: number): void;
    revealRange(range: IRange): void;
}

/**
 * Минимальный срез группы редакторов для открытия результата: открыть файл и
 * довести до позиции. `EditorService` соответствует ему структурно — связывание
 * делает DI-модуль (как {@link import("../../markers/browser/problemsComponent.ts").MarkerRevealTargetDIToken}).
 */
export interface ISearchRevealTarget {
    openUri(uri: Uri): void;
    getActiveEditor(): ISearchRevealEditor | null;
}

export const SearchRevealTargetDIToken = token<ISearchRevealTarget>("SearchRevealTarget");

/** Debounce before a query/toggle change spawns ripgrep (avoids a process per keystroke). */
const SEARCH_DEBOUNCE_MS = 150;
/**
 * Троттл полной пересборки строк в tree-режиме при стриме результатов: новый
 * файл может расколоть компакт-цепочку папок, а ListViewElement умеет только
 * append — проще пересобрать целиком, но не чаще раза в интервал.
 */
const TREE_REBUILD_THROTTLE_MS = 100;

/** Toggle button glyphs (TUI analogues of VS Code's case/word/regex icons). */
const CASE_GLYPH = "Aa";
const WORD_GLYPH = "\\b";
const REGEX_GLYPH = ".*";
/** Кнопка под строкой запроса — тумблер блока include/exclude (VS Code: Toggle Search Details). */
const DETAILS_GLYPH = "···";

/** Одна файл-группа накопленной модели результатов (порядок — порядок стрима). */
interface IFileGroup {
    readonly absolutePath: string;
    readonly relPath: string;
    readonly matches: ITextMatch[];
}

/** Метаданные строки списка — для активации и рестайла при смене темы. */
type RowMeta =
    | { readonly kind: "folder"; readonly element: TextLabelElement; readonly path: string }
    | { readonly kind: "file"; readonly element: TextLabelElement; readonly group: IFileGroup }
    | {
          readonly kind: "match";
          readonly element: TextLabelElement;
          readonly group: IFileGroup;
          readonly match: ITextMatch;
      };

/**
 * Pins a natural-height header on top and gives the remaining height to the
 * results list. VStack can't do this (its rows are all fixed height), so the
 * Search view uses this tiny two-slot vertical layout instead. Высота хедера —
 * интринсик (сумма его строк): блок include/exclude скрывается и раскрывается.
 */
class SearchViewElement extends TUIElement {
    public constructor(
        private readonly header: TUIElement,
        private readonly results: TUIElement,
    ) {
        super();
        this.appendChild(header);
        this.appendChild(results);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const headerHeight = Math.min(size.height, this.header.getMaxIntrinsicHeight(size.width));
        const resultsHeight = Math.max(0, size.height - headerHeight);

        this.layoutChild(this.header, 0, 0, BoxConstraints.tight(new Size(size.width, headerHeight)));
        this.layoutChild(this.results, 0, headerHeight, BoxConstraints.tight(new Size(size.width, resultsHeight)));
        return size;
    }
}

/**
 * Search view (left sidebar): a query input + case/whole-word/regex toggles,
 * files-to-include/exclude inputs, a result count, and the streamed results
 * list. Search-as-you-type (debounced) drives {@link TextSearchService}; results
 * stream into a virtualised {@link ListViewElement}. Режим `list` — файлы
 * плоским списком (матчи сворачиваются под файлом, инкрементальный стрим);
 * режим `tree` — иерархия каталогов с компакцией одиночных цепочек
 * ({@link buildSearchTree}), пересборка строк по троттлу
 * (`search.action.viewAsTree`/`viewAsList`, персист по-проектно).
 * Enter/double-click on a match opens the file at the
 * match position via the {@link ISearchRevealTarget} seam. Living в сайдбаре как
 * merged одно-view контейнер ({@link ViewsService}, mergeSingleView): заголовок
 * `SEARCH` с меню «⋯» рисует PaneHeaderElement, тело — {@link SearchViewElement}.
 */
export class SearchComponent extends Component {
    public static dependencies = [
        TextSearchServiceDIToken,
        ExplorerServiceDIToken,
        SearchRevealTargetDIToken,
        StateServiceDIToken,
        ContextKeyServiceDIToken,
        ViewsServiceDIToken,
    ] as const;

    private readonly root: SearchViewElement;
    private readonly queryInput = new InputElement();
    private readonly includeInput = new InputElement();
    private readonly excludeInput = new InputElement();
    private readonly caseButton = new ButtonElement(CASE_GLYPH);
    private readonly wordButton = new ButtonElement(WORD_GLYPH);
    private readonly regexButton = new ButtonElement(REGEX_GLYPH);
    private readonly detailsButton = new ButtonElement(DETAILS_GLYPH);
    private readonly countLabel = new TextLabelElement("");
    private readonly gaps: TextLabelElement[] = [];
    private readonly headerStack = new VStackElement();
    private readonly queryRow: HFlexElement;
    private readonly detailsRow: HFlexElement;
    /** Пустая строка-зазор между include и exclude в раскрытых деталях. */
    private readonly detailsGapRow = new FillerElement();
    /**
     * Результаты — виртуализирующий список; публичен для команд list-навигации и
     * тестов. Typeahead выключен: в панели поиска набор букв — это уточнение
     * запроса, а не прыжки по результатам (в отличие от дерева файлов).
     */
    public readonly results = new ListViewElement({ typeahead: false });
    private readonly scrollBars: ScrollBarDecorator;

    private caseSensitive = false;
    private wholeWord = false;
    private regex = false;

    /** Раскрыт ли блок include/exclude (VS Code: query details). */
    private detailsExpanded: boolean;
    private viewMode: SearchViewMode;
    private groups = new Map<string, IFileGroup>();
    private rowMeta = new Map<string, RowMeta>();
    private matchCount = 0;
    private handle: ISearchHandle | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    /** Отложенная пересборка строк tree-режима при стриме (см. TREE_REBUILD_THROTTLE_MS). */
    private treeRebuildTimer: ReturnType<typeof setTimeout> | null = null;
    /** Дебаунс пересчёта data-ключей hasSearchResult/viewHasSomeCollapsibleResult. */
    private resultKeysTimer: ReturnType<typeof setTimeout> | null = null;
    /** Родитель каждой строки — видимость/глубина для поэтапного Collapse All. */
    private rowParents = new Map<string, string | null>();
    /** Первая строка результатов — ключ firstMatchFocus (возврат Up в инпуты). */
    private firstRowId: string | null = null;
    /** Bumped per search so a stale in-flight callback/complete is ignored. */
    private searchGen = 0;

    public constructor(
        private readonly searchService: ITextSearchService,
        private readonly explorerService: ExplorerService,
        private readonly revealTarget: ISearchRevealTarget,
        private readonly stateService: IStateService,
        private readonly contextKeys: ContextKeyService,
        viewsService: ViewsService,
    ) {
        super();

        this.viewMode = this.stateService.get(SEARCH_VIEW_MODE_STATE);
        this.detailsExpanded = this.stateService.get(SEARCH_QUERY_DETAILS_STATE);
        // Data-ключ для toggled в меню «⋯»: ContextMenuService не дёргает
        // updateContextKeys, поэтому ключ сетится в момент изменения (прецедент
        // activeOutputChannel).
        this.contextKeys.set("searchViewMode", this.viewMode);

        this.queryInput.placeholder = "Search";
        this.includeInput.placeholder = "files to include";
        this.excludeInput.placeholder = "files to exclude";
        this.queryInput.onChange = () => {
            this.scheduleSearch();
        };
        this.includeInput.onChange = () => {
            this.scheduleSearch();
        };
        this.excludeInput.onChange = () => {
            this.scheduleSearch();
        };

        this.configureToggle(this.caseButton, () => {
            this.caseSensitive = !this.caseSensitive;
            this.onToggleChanged();
        });
        this.configureToggle(this.wordButton, () => {
            this.wholeWord = !this.wholeWord;
            this.onToggleChanged();
        });
        this.configureToggle(this.regexButton, () => {
            this.regex = !this.regex;
            this.onToggleChanged();
        });
        this.configureToggle(this.detailsButton, () => {
            this.toggleQueryDetails();
        });
        this.detailsButton.setChecked(this.detailsExpanded);

        this.results.id = "searchResults";
        this.results.onActivate = (element) => {
            // Список не принимает строки без id — здесь он гарантированно есть.
            this.activateRow(element.id!);
        };
        this.results.onCollapsedChanged = () => {
            this.scheduleResultKeysUpdate();
        };
        this.refreshResultKeys();
        this.scrollBars = new ScrollBarDecorator(this.results);

        this.queryRow = this.buildQueryRow();
        this.detailsRow = this.buildDetailsRow();
        this.rebuildHeader();
        // Инпуты и счётчик не прижаты к краям панели — отступы по колонке слева
        // и справа (прецедент: ChangesComponent паддит список изменений).
        const paddedHeader = new PaddingContainerElement(this.headerStack, { left: 1, right: 1 });

        this.root = new SearchViewElement(paddedHeader, this.scrollBars);
        this.root.id = "searchView";
        this.root.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.countLabel.setColors("descriptionForeground", INHERITED_BG);
        for (const gap of this.gaps) gap.setColors(INHERITED_FG, INHERITED_BG);

        // Тело единственной view merged-контейнера Search: заголовок секции —
        // заголовок вьюлета, «⋯»-меню приходит от PaneHeaderElement.
        viewsService.registerView({
            id: SEARCH_VIEW_ID,
            containerId: SEARCH_VIEWLET_ID,
            title: "SEARCH",
            order: 10,
            body: this.root,
            focus: () => {
                this.focus();
            },
        });

        this.register({
            dispose: () => {
                this.cancelSearch();
                if (this.resultKeysTimer !== null) {
                    clearTimeout(this.resultKeysTimer);
                    this.resultKeysTimer = null;
                }
            },
        });
    }

    public get view(): TUIElement {
        return this.root;
    }

    /** Focuses the query input (called when the Search view is shown). */
    public focus(): void {
        this.queryInput.focus();
    }

    /**
     * Collapse All с VS Code-поведением «поуровнево, с самого глубокого»
     * (CollapseDeepestExpandedLevel): (1) видны матч-строки → свернуть все
     * файл-строки (папки остаются раскрытыми); (2) иначе в tree-режиме видно
     * что-то глубже корня → свернуть всё рекурсивно; (3) иначе свернуть всё.
     */
    public collapseDeepestLevel(): void {
        const anyMatchVisible = [...this.rowMeta].some(
            ([id, meta]) => meta.kind === "match" && this.isRowVisible(id),
        );
        for (const [id, meta] of this.rowMeta) {
            if (meta.kind === "match") continue;
            if (anyMatchVisible && meta.kind !== "file") continue; // этап 1: только файлы
            this.results.setCollapsed(id, true);
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
     * Кольцо фокуса «вниз» (Down/Ctrl+Down из инпутов): query → include (если
     * детали раскрыты) → exclude → список результатов; скрытые инпуты
     * пропускаются (VS Code: focusNextInputBox).
     */
    public focusNextInputBox(): void {
        if (this.queryInput.isFocused) {
            if (this.detailsExpanded) {
                this.includeInput.focus();
            } else {
                this.results.focus();
            }
            return;
        }
        if (this.includeInput.isFocused) {
            this.excludeInput.focus();
            return;
        }
        if (this.excludeInput.isFocused) {
            this.results.focus();
        }
    }

    /** Кольцо фокуса «вверх»: exclude → include → query; из query — no-op (верх кольца). */
    public focusPreviousInputBox(): void {
        if (this.excludeInput.isFocused) {
            this.includeInput.focus();
            return;
        }
        if (this.includeInput.isFocused) {
            this.queryInput.focus();
        }
    }

    /**
     * Up с первой строки результатов — назад в инпуты: exclude при раскрытых
     * деталях, иначе query (VS Code: focusSearchFromResults / moveFocusFromResults).
     */
    public focusSearchFromResults(): void {
        if (this.detailsExpanded) {
            this.excludeInput.focus();
        } else {
            this.queryInput.focus();
        }
    }

    /** Активен список результатов и курсор на его первой строке (when-ключ `firstMatchFocus`). */
    public isFirstResultFocused(active: TUIElement | null): boolean {
        if (active !== this.results || this.firstRowId === null) return false;
        return this.results.getCursorElement()?.id === this.firstRowId;
    }

    /** Активный элемент внутри тела view поиска (when-ключ `searchViewletFocus`). */
    public containsFocus(active: TUIElement | null): boolean {
        for (let element = active; element !== null; element = element.getParent()) {
            if (element === this.root) return true;
        }
        return false;
    }

    /** Активный элемент — один из инпутов поиска (when-ключ `searchInputBoxFocus`). */
    public isInputBoxFocused(active: TUIElement | null): boolean {
        return active === this.queryInput || active === this.includeInput || active === this.excludeInput;
    }

    public getViewMode(): SearchViewMode {
        return this.viewMode;
    }

    /** Переключает вид дерево/плоско, пересобирая строки из модели (без нового rg). */
    public setViewMode(mode: SearchViewMode): void {
        if (mode === this.viewMode) return;
        this.viewMode = mode;
        this.contextKeys.set("searchViewMode", mode);
        this.stateService.store(SEARCH_VIEW_MODE_STATE, mode);
        this.rebuildRows();
    }

    /**
     * Восстанавливает состояние view из workspace-стора: режим дерево/плоско и
     * раскрытость блока include/exclude. Зовётся после `openWorkspace`, без
     * write-through. Детали раскрываются и при непустых полях (паритет VS Code:
     * непустые паттерны не должны прятаться).
     */
    public restoreViewState(): void {
        const mode = this.stateService.get(SEARCH_VIEW_MODE_STATE);
        if (mode !== this.viewMode) {
            this.viewMode = mode;
            this.contextKeys.set("searchViewMode", mode);
            this.rebuildRows();
        }
        const expanded =
            this.stateService.get(SEARCH_QUERY_DETAILS_STATE) ||
            this.includeInput.inputState.value !== "" ||
            this.excludeInput.inputState.value !== "";
        if (expanded !== this.detailsExpanded) {
            this.detailsExpanded = expanded;
            this.detailsButton.setChecked(expanded);
            this.rebuildHeader();
        }
    }

    /** Раскрыт ли блок include/exclude — кольцо фокуса пропускает скрытые инпуты. */
    public isQueryDetailsShown(): boolean {
        return this.detailsExpanded;
    }

    /**
     * Тумблер блока include/exclude (VS Code: Toggle Search Details,
     * Ctrl+Shift+J). Раскрытие уводит фокус в include, скрытие возвращает его в
     * строку запроса; `moveFocus: false` — только смена раскрытости (restore).
     */
    public toggleQueryDetails(show?: boolean, moveFocus = true): void {
        const next = show ?? !this.detailsExpanded;
        if (next !== this.detailsExpanded) {
            this.detailsExpanded = next;
            this.stateService.store(SEARCH_QUERY_DETAILS_STATE, next);
            this.detailsButton.setChecked(next);
            this.rebuildHeader();
        }
        if (!moveFocus) return;
        if (next) {
            this.includeInput.focus();
        } else {
            this.queryInput.focus();
        }
    }

    /**
     * Пересобирает строки хедера под текущую раскрытость деталей. Строка «···»
     * (правый край) — одновременно вертикальный зазор между строкой запроса и
     * остальным блоком; между include и exclude — пустая строка-Filler.
     */
    private rebuildHeader(): void {
        const rows: TUIElement[] = [this.queryRow, this.detailsRow];
        if (this.detailsExpanded) {
            rows.push(this.includeInput, this.detailsGapRow, this.excludeInput);
        }
        rows.push(this.countLabel);
        for (const row of rows) {
            row.layoutStyle = { width: "fill", height: 1 };
        }
        this.headerStack.replaceChildren(rows);
        this.headerStack.markDirty();
    }

    private buildDetailsRow(): HFlexElement {
        const row = new HFlexElement();
        row.addChild(new FillerElement(), { width: hflexFill(), height: 1 });
        row.addChild(this.detailsButton, { width: hflexFit(), height: 1 });
        return row;
    }

    private buildQueryRow(): HFlexElement {
        const row = new HFlexElement();
        const gap = () => {
            const g = new TextLabelElement("");
            this.gaps.push(g);
            return g;
        };
        row.addChild(this.queryInput, { width: hflexFill(), height: 1 });
        row.addChild(gap(), { width: hflexFixed(1), height: 1 });
        row.addChild(this.caseButton, { width: hflexFit(), height: 1 });
        row.addChild(gap(), { width: hflexFixed(1), height: 1 });
        row.addChild(this.wordButton, { width: hflexFit(), height: 1 });
        row.addChild(gap(), { width: hflexFixed(1), height: 1 });
        row.addChild(this.regexButton, { width: hflexFit(), height: 1 });
        return row;
    }

    private configureToggle(button: ButtonElement, onActivate: () => void): void {
        button.focusable = false; // keep focus in the query input on click
        button.onActivate = onActivate;
    }

    private onToggleChanged(): void {
        // «Включённый» вид тумблера — состояние checked на самой кнопке (Н3).
        this.caseButton.setChecked(this.caseSensitive);
        this.wordButton.setChecked(this.wholeWord);
        this.regexButton.setChecked(this.regex);
        this.runSearch();
    }

    private scheduleSearch(): void {
        if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.runSearch();
        }, SEARCH_DEBOUNCE_MS);
    }

    private runSearch(): void {
        this.cancelSearch();
        const gen = ++this.searchGen;
        this.groups.clear();
        this.rowMeta.clear();
        this.rowParents.clear();
        this.firstRowId = null;
        this.matchCount = 0;
        this.results.clear();
        this.scheduleResultKeysUpdate();

        const root = this.explorerService.getRootPath();
        const query = this.buildQuery();
        if (root === null || query.pattern === "") {
            this.updateCount(false);
            return;
        }

        this.updateCount(true);
        this.handle = this.searchService.search(query, root, (match) => {
            if (gen === this.searchGen) this.onResult(match, root);
        });
        void this.handle.complete.then(() => {
            if (gen === this.searchGen) {
                this.flushTreeRebuild();
                this.updateCount(false);
            }
        });
    }

    private onResult(match: IFileMatch, root: string): void {
        const relPath = labelFor(match.absolutePath, root);
        let group = this.groups.get(relPath);
        const isNewGroup = group === undefined;
        if (group === undefined) {
            group = { absolutePath: match.absolutePath, relPath, matches: [] };
            this.groups.set(relPath, group);
        }
        for (const m of match.matches) {
            group.matches.push(m);
            this.matchCount++;
        }
        if (this.viewMode === "list") {
            // Плоский список растёт инкрементально: файл-строка при первом матче
            // файла, дальше — только его матчи и счётчик.
            if (isNewGroup) this.appendFileRow(group, group.relPath);
            for (let i = group.matches.length - match.matches.length; i < group.matches.length; i++) {
                this.appendMatchRow(group, group.matches[i], i, fileRowId(group));
            }
            const fileMeta = this.rowMeta.get(fileRowId(group)) as Extract<RowMeta, { kind: "file" }>;
            formatFileRow(fileMeta.element, group.relPath, group.matches.length, this.rowStyles());
        } else {
            // Дерево пересобирается целиком (компакт-цепочки может расколоть
            // новый файл) — по троттлу, финальный flush на завершении поиска.
            this.scheduleTreeRebuild();
        }
        this.updateCount(true);
    }

    private appendFileRow(group: IFileGroup, label: string, parentId?: string): void {
        const id = fileRowId(group);
        const element = buildFileRow(id, label, group.matches.length, this.rowStyles());
        this.registerRow(id, { kind: "file", element, group }, parentId);
        this.results.appendRow(element, { label, parentId });
    }

    private appendMatchRow(group: IFileGroup, match: ITextMatch, index: number, parentId: string): void {
        // Индекс в группе вместо сквозного счётчика: id стабилен между полными
        // пересборками — иначе курсор и свёрнутость не восстановить.
        const id = `match:${group.relPath}:${String(index)}`;
        const element = buildMatchRow(id, match, this.rowStyles());
        this.registerRow(id, { kind: "match", element, group, match }, parentId);
        this.results.appendRow(element, { parentId });
    }

    private appendFolderRow(path: string, label: string, parentId?: string): void {
        const id = folderRowId(path);
        const element = buildFolderRow(id, label);
        this.registerRow(id, { kind: "folder", element, path }, parentId);
        this.results.appendRow(element, { label, parentId });
    }

    /** Общая бухгалтерия строки: метаданные, родитель, первая строка, data-ключи. */
    private registerRow(id: string, meta: RowMeta, parentId: string | undefined): void {
        this.rowMeta.set(id, meta);
        this.rowParents.set(id, parentId ?? null);
        this.firstRowId ??= id;
        this.scheduleResultKeysUpdate();
    }

    /** Видима ли строка: ни один предок не свёрнут. */
    private isRowVisible(id: string): boolean {
        for (let parent = this.rowParents.get(id); parent != null; parent = this.rowParents.get(parent)) {
            if (this.results.isCollapsed(parent)) return false;
        }
        return true;
    }

    private appendTreeNodes(nodes: readonly SearchTreeNode<IFileGroup>[], parentId: string | undefined): void {
        for (const node of nodes) {
            if (node.kind === "folder") {
                this.appendFolderRow(node.path, node.label, parentId);
                this.appendTreeNodes(node.children, folderRowId(node.path));
            } else {
                this.appendFileRow(node.item, node.name, parentId);
                node.item.matches.forEach((match, index) => {
                    this.appendMatchRow(node.item, match, index, fileRowId(node.item));
                });
            }
        }
    }

    /**
     * Data-ключи hasSearchResult/viewHasSomeCollapsibleResult — с дебаунсом
     * (стрим зовёт на каждую строку; скан проекции на каждую был бы O(n²)).
     */
    private scheduleResultKeysUpdate(): void {
        if (this.resultKeysTimer !== null) return;
        this.resultKeysTimer = setTimeout(() => {
            this.resultKeysTimer = null;
            this.refreshResultKeys();
        }, 100);
    }

    private refreshResultKeys(): void {
        this.contextKeys.set("hasSearchResult", this.matchCount > 0);
        this.contextKeys.set("viewHasSomeCollapsibleResult", this.results.hasVisibleExpandedRow());
    }

    private scheduleTreeRebuild(): void {
        if (this.treeRebuildTimer !== null) return;
        this.treeRebuildTimer = setTimeout(() => {
            this.treeRebuildTimer = null;
            this.rebuildRows();
        }, TREE_REBUILD_THROTTLE_MS);
    }

    /** Пересборка «сейчас», если троттл ещё ждёт (завершение поиска). */
    private flushTreeRebuild(): void {
        if (this.treeRebuildTimer === null) return;
        clearTimeout(this.treeRebuildTimer);
        this.treeRebuildTimer = null;
        this.rebuildRows();
    }

    /**
     * Пересобирает строки списка из накопленной модели (смена режима, стрим в
     * tree-режиме, восстановление). Свёрнутость и курсор переживают пересборку
     * по стабильным id; свёрнутая компакт-цепочка при расколе теряет
     * свёрнутость — её id умирает вместе с цепочкой.
     */
    private rebuildRows(): void {
        const cursorId = this.results.getCursorElement()?.id ?? null;
        const collapsedIds = this.results.getCollapsedIds();
        this.results.clear();
        this.rowMeta.clear();
        this.rowParents.clear();
        this.firstRowId = null;
        if (this.viewMode === "list") {
            for (const group of this.groups.values()) {
                this.appendFileRow(group, group.relPath);
                group.matches.forEach((match, index) => {
                    this.appendMatchRow(group, match, index, fileRowId(group));
                });
            }
        } else {
            this.appendTreeNodes(buildSearchTree(this.groups.values()), undefined);
        }
        for (const id of collapsedIds) {
            if (this.rowMeta.has(id)) this.results.setCollapsed(id, true);
        }
        if (cursorId !== null && this.rowMeta.has(cursorId)) {
            this.results.setCursorTo(cursorId);
        }
    }

    /** Enter/двойной клик: папка/файл сворачиваются, матч открывается на позиции. */
    private activateRow(rowId: string): void {
        const meta = this.rowMeta.get(rowId);
        /* v8 ignore start -- defensive: every appended row has meta under its id */
        if (meta === undefined) return;
        /* v8 ignore stop */
        if (meta.kind === "folder") {
            this.results.toggleCollapsed(folderRowId(meta.path));
            return;
        }
        if (meta.kind === "file") {
            this.results.toggleCollapsed(fileRowId(meta.group));
            return;
        }
        this.revealTarget.openUri(Uri.file(meta.group.absolutePath));
        const editor = this.revealTarget.getActiveEditor();
        /* v8 ignore start -- defensive: openUri always opens/activates an editor for the file */
        if (editor === null) return;
        /* v8 ignore stop */
        // lineNumber у ripgrep 1-based, редактор ждёт 0-based; колонки уже 0-based.
        const line = meta.match.lineNumber - 1;
        editor.goToPosition(line, meta.match.startColumn);
        editor.revealRange(createRange(line, meta.match.startColumn, line, meta.match.endColumn));
    }

    private buildQuery(): ITextSearchQuery {
        return {
            pattern: this.queryInput.inputState.value,
            isRegExp: this.regex,
            isCaseSensitive: this.caseSensitive,
            isWholeWord: this.wholeWord,
            includes: splitGlobs(this.includeInput.inputState.value),
            excludes: splitGlobs(this.excludeInput.inputState.value),
        };
    }

    private updateCount(searching: boolean): void {
        this.countLabel.setText(this.countText(searching));
        this.countLabel.markDirty();
    }

    private countText(searching: boolean): string {
        if (this.queryInput.inputState.value === "") return "";
        if (this.matchCount === 0) return searching ? "Searching…" : "No results";
        const files = this.groups.size === 1 ? "file" : "files";
        return `${this.matchCount} results in ${this.groups.size} ${files}`;
    }

    private cancelSearch(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.treeRebuildTimer !== null) {
            clearTimeout(this.treeRebuildTimer);
            this.treeRebuildTimer = null;
        }
        this.handle?.cancel();
        this.handle = null;
    }

    // Токены темы — резолвит каскад, рестайл строк на смену темы не нужен.
    private rowStyles(): ISearchRowStyles {
        return {
            dimFg: "descriptionForeground",
            matchFg: "sideBar.foreground",
            matchBg: "editor.wordHighlightBackground",
        };
    }
}

function fileRowId(group: IFileGroup): string {
    return `file:${group.relPath}`;
}

function folderRowId(path: string): string {
    return `dir:${path}`;
}

/** Splits a comma-separated glob field into trimmed, non-empty globs. */
function splitGlobs(value: string): string[] {
    return value
        .split(",")
        .map((g) => g.trim())
        .filter((g) => g !== "");
}

/**
 * Displays a matched file as a workspace-relative path (falls back to absolute),
 * with separators normalised to `/`. Handles both POSIX (`/`) and Windows (`\`)
 * paths, since ripgrep reports native separators — a long unstripped absolute
 * path would otherwise clip the basename off the right edge of the list.
 */
function labelFor(absolutePath: string, root: string): string {
    const rel = absolutePath.startsWith(root) ? absolutePath.slice(root.length).replace(/^[/\\]+/u, "") : absolutePath;
    return rel.replace(/\\/gu, "/");
}
