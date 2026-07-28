import { BoxConstraints, Offset, Point, Rect, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import type { IButtonStyles } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { InputElement } from "../../../../../../tuidom/ui/inputbox/inputElement.ts";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { VStackElement } from "../../../../../../tuidom/ui/layout/vStackElement.ts";
import { ListViewElement } from "../../../../../../tuidom/ui/list/listViewElement.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { TitledPanelElement } from "../../../../../../tuidom/ui/titledpanel/titledPanelElement.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import {
    getDialogButtonStyles,
    getListViewStyles,
    getScrollBarStyles,
} from "../../../../platform/theme/browser/defaultStyles.ts";
import { ThemedComponent } from "../../../browser/component.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { SEARCH_VIEW_MODE_STATE, type SearchViewMode } from "../../../common/stateKeys.ts";
import { ExplorerServiceDIToken } from "../../files/browser/explorerService.ts";
import type { ExplorerService } from "../../files/browser/explorerService.ts";
import type {
    IFileMatch,
    ISearchHandle,
    ITextMatch,
    ITextSearchQuery,
    ITextSearchService,
} from "../../../services/search/common/textSearch.ts";
import { TextSearchServiceDIToken } from "../../../services/search/common/textSearch.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

import { buildFileRow, buildMatchRow, formatFileRow, formatMatchRow, type ISearchRowStyles } from "./searchResultRows.ts";

export const SearchComponentDIToken = token<SearchComponent>("SearchComponent");

/** Id вьюлета Search в сайдбаре (совпадает с `view.id` и id команды `workbench.view.search`). */
export const SEARCH_VIEWLET_ID = "search";

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
/** Fixed rows of the header block above the results list. */
const HEADER_HEIGHT = 4;

/** Toggle button glyphs (TUI analogues of VS Code's case/word/regex icons). */
const CASE_GLYPH = "Aa";
const WORD_GLYPH = "\\b";
const REGEX_GLYPH = ".*";

/** Одна файл-группа накопленной модели результатов (порядок — порядок стрима). */
interface IFileGroup {
    readonly absolutePath: string;
    readonly relPath: string;
    readonly matches: ITextMatch[];
}

/** Метаданные строки списка — для активации и рестайла при смене темы. */
type RowMeta =
    | { readonly kind: "file"; readonly element: TextLabelElement; readonly group: IFileGroup }
    | { readonly kind: "match"; readonly element: TextLabelElement; readonly group: IFileGroup; readonly match: ITextMatch };

/**
 * Pins a fixed-height header on top and gives the remaining height to the
 * results list. VStack can't do this (its rows are all fixed height), so the
 * Search view uses this tiny two-slot vertical layout instead.
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
        const headerHeight = Math.min(size.height, HEADER_HEIGHT);
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
 * stream into a virtualised {@link ListViewElement} grouped by file. In the
 * `tree` view mode file groups are collapsible; the `flat` mode shows the same
 * grouped rows without collapsing (`search.action.viewAsTree`/`viewAsList`,
 * persisted per workspace). Enter/double-click on a match opens the file at the
 * match position via the {@link ISearchRevealTarget} seam. Framing mirrors
 * {@link import("../../files/browser/explorerComponent.ts").ExplorerComponent}
 * (TitledPanel + `sideBar.*` colors).
 */
export class SearchComponent extends ThemedComponent {
    public static dependencies = [
        TextSearchServiceDIToken,
        ExplorerServiceDIToken,
        SearchRevealTargetDIToken,
        StateServiceDIToken,
        ThemeServiceDIToken,
    ] as const;

    private readonly root: TitledPanelElement;
    private readonly queryInput = new InputElement();
    private readonly includeInput = new InputElement();
    private readonly excludeInput = new InputElement();
    private readonly caseButton = new ButtonElement(CASE_GLYPH);
    private readonly wordButton = new ButtonElement(WORD_GLYPH);
    private readonly regexButton = new ButtonElement(REGEX_GLYPH);
    private readonly countLabel = new TextLabelElement("");
    private readonly gaps: TextLabelElement[] = [];
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

    private viewMode: SearchViewMode;
    private groups = new Map<string, IFileGroup>();
    private rowMeta = new Map<string, RowMeta>();
    /** Сквозной счётчик матч-строк — гарантия уникальности id в пределах поиска. */
    private matchSeq = 0;
    private matchCount = 0;
    private handle: ISearchHandle | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    /** Bumped per search so a stale in-flight callback/complete is ignored. */
    private searchGen = 0;

    public constructor(
        private readonly searchService: ITextSearchService,
        private readonly explorerService: ExplorerService,
        private readonly revealTarget: ISearchRevealTarget,
        private readonly stateService: IStateService,
        themeService: ThemeService,
    ) {
        super(themeService);

        this.viewMode = this.stateService.get(SEARCH_VIEW_MODE_STATE);

        this.queryInput.placeholder = "Search";
        this.includeInput.placeholder = "files to include";
        this.excludeInput.placeholder = "files to exclude";
        this.queryInput.onChange = () => this.scheduleSearch();
        this.includeInput.onChange = () => this.scheduleSearch();
        this.excludeInput.onChange = () => this.scheduleSearch();

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

        this.results.id = "searchResults";
        this.results.onActivate = (element) => {
            // Список не принимает строки без id — здесь он гарантированно есть.
            this.activateRow(element.id as string);
        };
        this.scrollBars = new ScrollBarDecorator(this.results);

        const header = new VStackElement();
        header.addChild(this.buildQueryRow(), { width: "fill", height: 1 });
        header.addChild(this.includeInput, { width: "fill", height: 1 });
        header.addChild(this.excludeInput, { width: "fill", height: 1 });
        header.addChild(this.countLabel, { width: "fill", height: 1 });

        this.root = new TitledPanelElement("  SEARCH", new SearchViewElement(header, this.scrollBars));
        this.root.id = "search";

        this.register({ dispose: () => this.cancelSearch() });
        this.initStyles();
    }

    public get view(): TUIElement {
        return this.root;
    }

    /** Focuses the query input (called when the Search view is shown). */
    public focus(): void {
        this.queryInput.focus();
    }

    public getViewMode(): SearchViewMode {
        return this.viewMode;
    }

    /** Переключает вид дерево/плоско, пересобирая строки из модели (без нового rg). */
    public setViewMode(mode: SearchViewMode): void {
        if (mode === this.viewMode) return;
        this.viewMode = mode;
        this.stateService.store(SEARCH_VIEW_MODE_STATE, mode);
        this.rebuildRows();
    }

    /** Восстанавливает вид из workspace-стора (зовётся после `openWorkspace`, без write-through). */
    public restoreViewMode(): void {
        const mode = this.stateService.get(SEARCH_VIEW_MODE_STATE);
        if (mode === this.viewMode) return;
        this.viewMode = mode;
        this.rebuildRows();
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
        button.tabIndex = -1; // keep focus in the query input on click
        button.onActivate = onActivate;
    }

    private onToggleChanged(): void {
        this.updateStyles(); // reflect the new active/inactive look immediately
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
        this.matchSeq = 0;
        this.matchCount = 0;
        this.results.clear();

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
            if (gen === this.searchGen) this.updateCount(false);
        });
    }

    private onResult(match: IFileMatch, root: string): void {
        const relPath = labelFor(match.absolutePath, root);
        let group = this.groups.get(relPath);
        if (group === undefined) {
            group = { absolutePath: match.absolutePath, relPath, matches: [] };
            this.groups.set(relPath, group);
            this.appendFileRow(group);
        }
        for (const m of match.matches) {
            group.matches.push(m);
            this.appendMatchRow(group, m);
            this.matchCount++;
        }
        // Файл-строка группы гарантированно добавлена выше — обновляем её счётчик.
        const fileMeta = this.rowMeta.get(fileRowId(group)) as Extract<RowMeta, { kind: "file" }>;
        formatFileRow(fileMeta.element, group.relPath, group.matches.length, this.rowStyles());
        this.updateCount(true);
    }

    private appendFileRow(group: IFileGroup): void {
        const id = fileRowId(group);
        const element = buildFileRow(id, group.relPath, group.matches.length, this.rowStyles());
        this.rowMeta.set(id, { kind: "file", element, group });
        this.results.appendRow(element, { label: group.relPath });
    }

    private appendMatchRow(group: IFileGroup, match: ITextMatch): void {
        const id = `match:${this.matchSeq++}:${group.relPath}:${match.lineNumber}:${match.startColumn}`;
        const element = buildMatchRow(id, match, this.rowStyles());
        this.rowMeta.set(id, { kind: "match", element, group, match });
        // Вся разница режимов: в дереве матчи — дети файл-строки (шевроны,
        // сворачивание), в плоском — самостоятельные строки без гуттера.
        this.results.appendRow(element, this.viewMode === "tree" ? { parentId: fileRowId(group) } : undefined);
    }

    /** Пересобирает строки списка из накопленной модели (смена режима/восстановление). */
    private rebuildRows(): void {
        this.results.clear();
        this.rowMeta.clear();
        this.matchSeq = 0;
        for (const group of this.groups.values()) {
            this.appendFileRow(group);
            for (const match of group.matches) {
                this.appendMatchRow(group, match);
            }
        }
    }

    /** Enter/двойной клик: файл-строка сворачивается, матч открывается на позиции. */
    private activateRow(rowId: string): void {
        const meta = this.rowMeta.get(rowId);
        /* v8 ignore start -- defensive: every appended row has meta under its id */
        if (meta === undefined) return;
        /* v8 ignore stop */
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
        this.handle?.cancel();
        this.handle = null;
    }

    private rowStyles(): ISearchRowStyles {
        return {
            dimFg: this.theme.getRequiredColor("descriptionForeground"),
            matchFg: this.theme.getRequiredColor("sideBar.foreground"),
            matchBg: this.theme.getRequiredColor("editor.wordHighlightBackground"),
        };
    }

    protected updateStyles(): void {
        const fg = this.theme.getRequiredColor("sideBar.foreground");
        const bg = this.theme.getRequiredColor("sideBar.background");
        const dimFg = this.theme.getRequiredColor("descriptionForeground");

        this.root.style = { fg, bg };
        this.countLabel.setColors(dimFg, bg);
        for (const gap of this.gaps) gap.setColors(fg, bg);
        this.scrollBars.setStyles(getScrollBarStyles(this.theme, "sideBar.background"));
        this.results.setStyles(getListViewStyles(this.theme));

        // Содержимое строк красится их формат-функциями — прогоняем рестайл по всем.
        const styles = this.rowStyles();
        for (const meta of this.rowMeta.values()) {
            if (meta.kind === "file") {
                formatFileRow(meta.element, meta.group.relPath, meta.group.matches.length, styles);
            } else {
                formatMatchRow(meta.element, meta.match, styles);
            }
        }

        const inactive = getDialogButtonStyles(this.theme);
        const active = this.activeButtonStyles();
        this.caseButton.setStyles(this.caseSensitive ? active : inactive);
        this.wordButton.setStyles(this.wholeWord ? active : inactive);
        this.regexButton.setStyles(this.regex ? active : inactive);
    }

    private activeButtonStyles(): IButtonStyles {
        const fg = this.theme.getRequiredColor("button.foreground");
        const bg = this.theme.getRequiredColor("button.background");
        const hoverBg = this.theme.getRequiredColor("button.hoverBackground");
        return { fg, bg, hoverBg, focusedFg: fg, focusedBg: bg, focusedHoverBg: hoverBg };
    }
}

function fileRowId(group: IFileGroup): string {
    return `file:${group.relPath}`;
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
