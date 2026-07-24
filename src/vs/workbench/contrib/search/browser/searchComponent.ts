import { BoxConstraints, Offset, Point, Rect, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import type { IButtonStyles } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { InputElement } from "../../../../../../tuidom/ui/inputbox/inputElement.ts";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { VStackElement } from "../../../../../../tuidom/ui/layout/vStackElement.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { TitledPanelElement } from "../../../../../../tuidom/ui/titledpanel/titledPanelElement.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { getDialogButtonStyles, getScrollBarStyles } from "../../../../platform/theme/browser/defaultStyles.ts";
import { ThemedComponent } from "../../../browser/component.ts";
import { ExplorerServiceDIToken } from "../../files/browser/explorerService.ts";
import type { ExplorerService } from "../../files/browser/explorerService.ts";
import type {
    IFileMatch,
    ISearchHandle,
    ITextSearchQuery,
    ITextSearchService,
} from "../../../services/search/common/textSearch.ts";
import { TextSearchServiceDIToken } from "../../../services/search/common/textSearch.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

import { SearchResultsElement, type SearchRow } from "./searchResultsElement.ts";

export const SearchComponentDIToken = token<SearchComponent>("SearchComponent");

/** Id вьюлета Search в сайдбаре (совпадает с `view.id` и id команды `workbench.view.search`). */
export const SEARCH_VIEWLET_ID = "search";

/** Debounce before a query/toggle change spawns ripgrep (avoids a process per keystroke). */
const SEARCH_DEBOUNCE_MS = 150;
/** Fixed rows of the header block above the results list. */
const HEADER_HEIGHT = 4;

/** Toggle button glyphs (TUI analogues of VS Code's case/word/regex icons). */
const CASE_GLYPH = "Aa";
const WORD_GLYPH = "\\b";
const REGEX_GLYPH = ".*";

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
        header.setParent(this);
        results.setParent(this);
    }

    public override getChildren(): readonly TUIElement[] {
        return [this.header, this.results];
    }

    public override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const headerHeight = Math.min(size.height, HEADER_HEIGHT);
        const resultsHeight = Math.max(0, size.height - headerHeight);

        this.header.localPosition = new Offset(0, 0);
        this.header.globalPosition = new Point(this.globalPosition.x, this.globalPosition.y);
        this.header.performLayout(BoxConstraints.tight(new Size(size.width, headerHeight)));

        this.results.localPosition = new Offset(0, headerHeight);
        this.results.globalPosition = new Point(this.globalPosition.x, this.globalPosition.y + headerHeight);
        this.results.performLayout(BoxConstraints.tight(new Size(size.width, resultsHeight)));
        return size;
    }

    public override render(context: RenderContext): void {
        for (const child of this.getChildren()) {
            const offset = new Offset(child.localPosition.dx, child.localPosition.dy);
            const clip = new Rect(child.globalPosition, child.layoutSize);
            child.render(context.withOffset(offset).withClip(clip));
        }
    }
}

/**
 * Search view (left sidebar): a query input + case/whole-word/regex toggles,
 * files-to-include/exclude inputs, a result count, and the streamed results
 * list. Search-as-you-type (debounced) drives {@link TextSearchService}; results
 * stream into {@link SearchResultsElement} grouped by file. Opening a result in
 * the editor and a collapsible results tree are later steps. Framing mirrors
 * {@link import("../../files/browser/explorerComponent.ts").ExplorerComponent}
 * (TitledPanel + `sideBar.*` colors).
 */
export class SearchComponent extends ThemedComponent {
    public static dependencies = [TextSearchServiceDIToken, ExplorerServiceDIToken, ThemeServiceDIToken] as const;

    private readonly root: TitledPanelElement;
    private readonly queryInput = new InputElement();
    private readonly includeInput = new InputElement();
    private readonly excludeInput = new InputElement();
    private readonly caseButton = new ButtonElement(CASE_GLYPH);
    private readonly wordButton = new ButtonElement(WORD_GLYPH);
    private readonly regexButton = new ButtonElement(REGEX_GLYPH);
    private readonly countLabel = new TextLabelElement("");
    private readonly gaps: TextLabelElement[] = [];
    private readonly results = new SearchResultsElement();
    private readonly scrollBars: ScrollBarDecorator;

    private caseSensitive = false;
    private wholeWord = false;
    private regex = false;

    private rows: SearchRow[] = [];
    private matchCount = 0;
    private fileCount = 0;
    private currentFileRow: Extract<SearchRow, { kind: "file" }> | null = null;
    private handle: ISearchHandle | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    /** Bumped per search so a stale in-flight callback/complete is ignored. */
    private searchGen = 0;

    public constructor(
        private readonly searchService: ITextSearchService,
        private readonly explorerService: ExplorerService,
        themeService: ThemeService,
    ) {
        super(themeService);

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

        this.scrollBars = new ScrollBarDecorator(this.results);
        this.results.setRows(this.rows);

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
        this.rows = [];
        this.currentFileRow = null;
        this.matchCount = 0;
        this.fileCount = 0;
        this.results.setRows(this.rows);

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
        if (this.currentFileRow === null || labelFor(match.absolutePath, root) !== this.currentFileRow.label) {
            this.currentFileRow = { kind: "file", label: labelFor(match.absolutePath, root), count: 0 };
            this.rows.push(this.currentFileRow);
            this.fileCount++;
        }
        for (const m of match.matches) {
            this.rows.push({ kind: "match", lineNumber: m.lineNumber, ...m.preview });
            this.currentFileRow.count++;
            this.matchCount++;
        }
        this.results.markDirty();
        this.updateCount(true);
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
        const files = this.fileCount === 1 ? "file" : "files";
        return `${this.matchCount} results in ${this.fileCount} ${files}`;
    }

    private cancelSearch(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.handle?.cancel();
        this.handle = null;
    }

    protected updateStyles(): void {
        const fg = this.theme.getRequiredColor("sideBar.foreground");
        const bg = this.theme.getRequiredColor("sideBar.background");
        const dimFg = this.theme.getRequiredColor("descriptionForeground");

        this.root.style = { fg, bg };
        this.countLabel.setColors(dimFg, bg);
        for (const gap of this.gaps) gap.setColors(fg, bg);
        this.scrollBars.setStyles(getScrollBarStyles(this.theme, "sideBar.background"));
        this.results.setStyles({
            fg,
            bg,
            dimFg,
            matchFg: fg,
            matchBg: this.theme.getRequiredColor("editor.wordHighlightBackground"),
        });

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
