import { INHERITED_BG, INHERITED_FG } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { listRowId } from "../../../../base/common/listRowId.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { Component } from "../../../browser/component.ts";
import { HeaderBodyViewElement } from "../../../browser/parts/views/headerBodyViewElement.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { IViewWelcomeBlock } from "../../../browser/parts/views/viewWelcomeElement.ts";
import { readUseIgnoreFiles, searchExcludeGlobs } from "../../../common/configuration/excludeSettings.ts";
import { SEARCH_QUERY_DETAILS_STATE, SEARCH_VIEW_MODE_STATE, type SearchViewMode } from "../../../common/stateKeys.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type {
    IFileMatch,
    ISearchHandle,
    ITextMatch,
    ITextSearchQuery,
    ITextSearchService,
} from "../../../services/search/common/textSearch.ts";
import { parseSearchFieldGlobs, TextSearchServiceDIToken } from "../../../services/search/common/textSearch.ts";

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

export const SEARCH_VIEWLET_ID = "search";

export const SEARCH_VIEW_ID = "workbench.search.results";

// Not the upstream text ("Only open editors are currently searched"): we have no search over
// open editors, the query goes to ripgrep over the root.
const SEARCH_WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "Search needs an open folder." },
    { kind: "text", text: "" },
    { kind: "button", label: "Open Folder", command: "workbench.action.files.openFolder" },
];

export interface ISearchRevealEditor {
    goToPosition(line: number, column?: number): void;
    revealRange(range: IRange): void;
}

export interface ISearchRevealTarget {
    openUri(uri: Uri): void;
    getActiveEditor(): ISearchRevealEditor | null;
}

export const SearchRevealTargetDIToken = token<ISearchRevealTarget>("SearchRevealTarget");

const SEARCH_DEBOUNCE_MS = 150;
// ListViewElement can only append, and a new file may split a compact folder chain —
// tree mode is rebuilt entirely, but at most once per interval.
const TREE_REBUILD_THROTTLE_MS = 100;

const CASE_GLYPH = "Aa";
const WORD_GLYPH = "\\b";
const REGEX_GLYPH = ".*";
const DETAILS_GLYPH = "···";

interface IFileGroup {
    readonly absolutePath: string;
    readonly relPath: string;
    readonly matches: ITextMatch[];
}

type RowMeta =
    | { readonly kind: "folder"; readonly element: TextLabelElement; readonly path: string }
    | { readonly kind: "file"; readonly element: TextLabelElement; readonly group: IFileGroup }
    | {
          readonly kind: "match";
          readonly element: TextLabelElement;
          readonly group: IFileGroup;
          readonly match: ITextMatch;
      };

export class SearchComponent extends Component implements IContextKeyContributor {
    public static dependencies = [
        TextSearchServiceDIToken,
        IWorkspaceContextServiceDIToken,
        SearchRevealTargetDIToken,
        StateServiceDIToken,
        ContextKeyServiceDIToken,
        ViewsServiceDIToken,
        JumpRecorderDIToken,
        IConfigurationServiceDIToken,
    ] as const;

    private readonly root: HeaderBodyViewElement;
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
    private readonly detailsGapRow = new FillerElement();
    // Typeahead is off: typing letters in the search panel refines the query instead of jumping through results.
    public readonly results = new ListViewElement({ typeahead: false });
    private readonly scrollBars: ScrollBarDecorator;

    private caseSensitive = false;
    private wholeWord = false;
    private regex = false;

    private detailsExpanded: boolean;
    private viewMode: SearchViewMode;
    private groups = new Map<string, IFileGroup>();
    private rowMeta = new Map<string, RowMeta>();
    private matchCount = 0;
    private handle: ISearchHandle | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private treeRebuildTimer: ReturnType<typeof setTimeout> | null = null;
    private resultKeysTimer: ReturnType<typeof setTimeout> | null = null;
    private rowParents = new Map<string, string | null>();
    private firstRowId: string | null = null;
    private readonly latestSearch = new LatestRequest();

    public constructor(
        private readonly searchService: ITextSearchService,
        private readonly workspaceContext: IWorkspaceContextService,
        private readonly revealTarget: ISearchRevealTarget,
        private readonly stateService: IStateService,
        private readonly contextKeys: ContextKeyService,
        viewsService: ViewsService,
        private readonly jumps: IJumpRecorder,
        private readonly configurationService: IConfigurationService,
    ) {
        super();

        this.viewMode = this.stateService.get(SEARCH_VIEW_MODE_STATE);
        this.detailsExpanded = this.stateService.get(SEARCH_QUERY_DETAILS_STATE);
        this.register(
            this.stateService.onDidOpenWorkspace(() => {
                this.restoreViewState();
            }),
        );
        // ContextMenuService doesn't call updateContextKeys — the key for `toggled` in "⋯" is set on change.
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
            this.activateRow(listRowId(element));
        };
        this.results.onCollapsedChanged = () => {
            this.scheduleResultKeysUpdate();
        };
        this.refreshResultKeys();
        this.scrollBars = new ScrollBarDecorator(this.results);

        this.queryRow = this.buildQueryRow();
        this.detailsRow = this.buildDetailsRow();
        this.rebuildHeader();
        const paddedHeader = new PaddingContainerElement(this.headerStack, { left: 1, right: 1 });

        this.root = new HeaderBodyViewElement(paddedHeader, this.scrollBars);
        this.root.id = "searchView";
        this.root.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.countLabel.setColors("descriptionForeground", INHERITED_BG);
        for (const gap of this.gaps) gap.setColors(INHERITED_FG, INHERITED_BG);

        viewsService.registerContainer({
            id: SEARCH_VIEWLET_ID,
            title: "SEARCH",
            // Stryker disable next-line StringLiteral: ViewsService only distinguishes "panel"; any other value (including a mutated one) goes to the sidebar, so replacing the string has no observable effect
            location: "sidebar",
            order: 1,
            visibleContextKey: "searchViewletVisible",
        });
        viewsService.registerView({
            canMoveView: true,
            id: SEARCH_VIEW_ID,
            containerId: SEARCH_VIEWLET_ID,
            title: "SEARCH",
            order: 10,
            body: this.root,
            // The query root is the workspace folder (runSearch): without it the field would silently answer "No results".
            requiresWorkspaceFolder: true,
            placeholder: SEARCH_WELCOME,
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

    public focus(): void {
        this.queryInput.focus();
    }

    /** Like upstream CollapseDeepestExpandedLevel: matches visible → collapse only files, otherwise everything. */
    public collapseDeepestLevel(): void {
        const anyMatchVisible = [...this.rowMeta].some(([id, meta]) => meta.kind === "match" && this.isRowVisible(id));
        for (const [id, meta] of this.rowMeta) {
            if (meta.kind === "match") continue;
            if (anyMatchVisible && meta.kind !== "file") continue; // stage 1: files only
            this.results.setCollapsed(id, true);
        }
        this.refreshResultKeys();
    }

    public expandAll(): void {
        for (const id of this.results.getCollapsedIds()) {
            this.results.setCollapsed(id, false);
        }
        this.refreshResultKeys();
    }

    /** Upstream `selectNextMatch`: the match after the cursor in display order, wrapping; collapsed ancestors expand. */
    public focusNextResult(): void {
        this.stepMatch(1);
    }

    /** Upstream `selectPreviousMatch`: from a file row it is the last match of the file above. */
    public focusPreviousResult(): void {
        this.stepMatch(-1);
    }

    private stepMatch(delta: 1 | -1): void {
        // Only an empty list has no cursor.
        const cursor = this.results.getCursorElement();
        if (cursor === null) return;
        // rowMeta keeps insertion order, which is the display order of the rows.
        const rows = [...this.rowMeta];
        const start = rows.findIndex(([id]) => id === cursor.id);
        // The last step comes back to the cursor itself: a lone match is reopened, as upstream.
        for (let step = 1; step <= rows.length; step++) {
            const [id, meta] = rows[(((start + delta * step) % rows.length) + rows.length) % rows.length];
            if (meta.kind !== "match") continue;
            this.results.setCursorTo(id);
            this.activateRow(id);
            return;
        }
    }

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

    public focusPreviousInputBox(): void {
        if (this.excludeInput.isFocused) {
            this.includeInput.focus();
            return;
        }
        if (this.includeInput.isFocused) {
            this.queryInput.focus();
        }
    }

    public focusSearchFromResults(): void {
        if (this.detailsExpanded) {
            this.excludeInput.focus();
        } else {
            this.queryInput.focus();
        }
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("searchViewletFocus", this.containsFocus(active));
        contextKeys.set("searchInputBoxFocus", this.isInputBoxFocused(active));
        contextKeys.set("firstMatchFocus", this.isFirstResultFocused(active));
    }

    private isFirstResultFocused(active: TUIElement | null): boolean {
        if (active !== this.results || this.firstRowId === null) return false;
        return this.results.getCursorElement()?.id === this.firstRowId;
    }

    private containsFocus(active: TUIElement | null): boolean {
        for (let element = active; element !== null; element = element.getParent()) {
            if (element === this.root) return true;
        }
        return false;
    }

    private isInputBoxFocused(active: TUIElement | null): boolean {
        return active === this.queryInput || active === this.includeInput || active === this.excludeInput;
    }

    public getViewMode(): SearchViewMode {
        return this.viewMode;
    }

    public setViewMode(mode: SearchViewMode): void {
        if (mode === this.viewMode) return;
        this.viewMode = mode;
        this.contextKeys.set("searchViewMode", mode);
        this.stateService.store(SEARCH_VIEW_MODE_STATE, mode);
        this.rebuildRows();
    }

    /** Details expand with non-empty fields too: non-empty patterns are not hidden (VS Code parity). */
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

    public isQueryDetailsShown(): boolean {
        return this.detailsExpanded;
    }

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

    // The "···" row doubles as the vertical gap between the query row and the rest of the block.
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
        const ticket = this.latestSearch.start();
        this.groups.clear();
        this.rowMeta.clear();
        this.rowParents.clear();
        this.firstRowId = null;
        this.matchCount = 0;
        this.results.clear();
        this.scheduleResultKeysUpdate();

        // `folders.at(0)` is a deliberate narrowing to one folder (multi-root is stage C in docs/TODO/MultiRoot.md).
        const root = this.workspaceContext.getWorkspace().folders.at(0)?.uri.fsPath ?? null;
        const query = this.buildQuery();
        if (root === null || query.pattern === "") {
            this.updateCount(false);
            return;
        }

        this.updateCount(true);
        this.handle = this.searchService.search(query, root, (match) => {
            if (!ticket.isStale()) this.onResult(match, root);
        });
        void this.handle.complete.then(() => {
            if (!ticket.isStale()) {
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
            if (isNewGroup) this.appendFileRow(group, group.relPath);
            for (let i = group.matches.length - match.matches.length; i < group.matches.length; i++) {
                this.appendMatchRow(group, group.matches[i], i, fileRowId(group));
            }
            const fileMeta = this.rowMeta.get(fileRowId(group)) as Extract<RowMeta, { kind: "file" }>;
            formatFileRow(fileMeta.element, group.relPath, group.matches.length, this.rowStyles());
        } else {
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
        // The index within the group instead of a running counter: the id is stable across full
        // rebuilds — otherwise the cursor and collapsed state can't be restored.
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

    private registerRow(id: string, meta: RowMeta, parentId: string | undefined): void {
        this.rowMeta.set(id, meta);
        this.rowParents.set(id, parentId ?? null);
        this.firstRowId ??= id;
        this.scheduleResultKeysUpdate();
    }

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

    // Debounced: the stream calls it per row, and a projection scan on each is O(n²).
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

    private flushTreeRebuild(): void {
        if (this.treeRebuildTimer === null) return;
        clearTimeout(this.treeRebuildTimer);
        this.treeRebuildTimer = null;
        this.rebuildRows();
    }

    // Collapsed state and cursor survive a rebuild via stable ids; a collapsed compact chain
    // loses its collapsed state when split — its id dies with the chain.
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
        this.jumps.jump(() => {
            this.revealTarget.openUri(Uri.file(meta.group.absolutePath));
            const editor = this.revealTarget.getActiveEditor();
            /* v8 ignore start -- defensive: openUri always opens/activates an editor for the file */
            // Stryker disable next-line ConditionalExpression: the branch is unreachable for the same reason as for coverage
            if (editor === null) return;
            /* v8 ignore stop */
            // ripgrep's lineNumber is 1-based, the editor expects 0-based; columns are already 0-based.
            const line = meta.match.lineNumber - 1;
            editor.goToPosition(line, meta.match.startColumn);
            editor.revealRange(createRange(line, meta.match.startColumn, line, meta.match.endColumn));
        });
    }

    private buildQuery(): ITextSearchQuery {
        return {
            pattern: this.queryInput.inputState.value,
            isRegExp: this.regex,
            isCaseSensitive: this.caseSensitive,
            isWholeWord: this.wholeWord,
            includes: parseSearchFieldGlobs(this.includeInput.inputState.value),
            // Settings come before the typed patterns, not instead of them: the field refines the query on top, like upstream.
            // Setting patterns are root-relative (`common` is only `<root>/common`), typed ones match at any depth (`**/…`).
            excludes: [
                ...searchExcludeGlobs(this.configurationService),
                ...parseSearchFieldGlobs(this.excludeInput.inputState.value),
            ],
            useIgnoreFiles: readUseIgnoreFiles(this.configurationService),
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

    // Theme tokens are resolved by the cascade, so rows need no restyle on theme change.
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

// ripgrep returns native separators (`/` and `\`); an unstripped absolute path would cut off
// the basename at the right edge of the list.
function labelFor(absolutePath: string, root: string): string {
    const rel = absolutePath.startsWith(root) ? absolutePath.slice(root.length).replace(/^[/\\]+/u, "") : absolutePath;
    return rel.replace(/\\/gu, "/");
}
