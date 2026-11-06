import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import type { MenuEntry, MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import type { ITreeDataProvider, ITreeItem, ITreeItemAction } from "@tuidom/elements/tree/iTreeDataProvider";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { codicon, type IProductIcon } from "../../../../base/common/codicons.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import {
    CHECKED_ICON,
    type IMenuEntryGroup,
    joinMenuGroups,
    type MenuContextKeys,
    type MenuRegistry,
    MenuRegistryDIToken,
} from "../../../../platform/actions/common/menuRegistry.ts";
import { type MenuService, MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import {
    type ContextMenuService,
    ContextMenuServiceDIToken,
} from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type ProgressService,
    ProgressServiceDIToken,
    SPINNER_FRAMES,
} from "../../../../platform/progress/common/progressService.ts";
import {
    type IStateDescriptor,
    type IStateService,
    StateServiceDIToken,
} from "../../../../platform/state/common/iStateService.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import {
    type IWireTestItemArg,
    TestId,
    TestItemExpandState,
    TestResultState,
} from "../../../api/common/testingWireTypes.ts";
import { Component } from "../../../browser/component.ts";
import { HeaderBodyViewElement } from "../../../browser/parts/views/headerBodyViewElement.ts";
import {
    bindMenuEntry,
    INLINE_MENU_GROUP,
    inlineMenuActions,
    inlineMenuEntries,
    runMenuEntry,
} from "../../../browser/parts/views/treeItemMenu.ts";
import { type ViewsService, ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { IViewWelcomeBlock } from "../../../browser/parts/views/viewWelcomeElement.ts";
import { onDidChangeTreeIndentGuides, treeIndentGuides } from "../../../browser/treeIndentGuides.ts";
import { type IJumpRecorder, JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import { type IRevealLocationTarget, revealLocation } from "../../../services/history/browser/revealLocation.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import {
    FilterResult,
    filterTest,
    isEmptyFilter,
    type ITestExplorerFilter,
    parseTestExplorerFilter,
    TestFilterTerm,
    toggleFilterTerm,
} from "../common/testExplorerFilter.ts";
import {
    computeState,
    formatDuration,
    isFailedState,
    isStateWithResult,
    statePriority,
    statesInOrder,
} from "../common/testingStates.ts";
import type { ITestResultItemChange, LiveTestResult } from "../common/testResult.ts";
import { type TestResultService, TestResultServiceDIToken } from "../common/testResultService.ts";
import { type ITestNode, type TestService, TestServiceDIToken } from "../common/testService.ts";

/** Upstream `Testing.ViewletId`. */
export const TESTING_VIEWLET_ID = "workbench.view.extension.test";
/** Upstream `Testing.ExplorerViewId`. */
export const TESTING_EXPLORER_VIEW_ID = "workbench.view.testing";

export const TestingRevealTargetDIToken = token<IRevealLocationTarget>("TestingRevealTarget");
export const TestingExplorerComponentDIToken = token<TestingExplorerComponent>("TestingExplorerComponent");

/** Upstream `TestExplorerViewSorting`. */
export type TestExplorerViewSorting = "location" | "status" | "duration";

/** Upstream's `testing.viewSorting` in the workspace storage; its default there is by location. */
export const TESTING_VIEW_SORTING_STATE: IStateDescriptor<TestExplorerViewSorting> = {
    key: "testing.viewSorting",
    scope: "workspace",
    default: "location",
};

/** Upstream's view `when`: the container shows while some extension has a controller. */
const VIEW_WHEN = "testing.providerCount > 0";

/** `testingExplorerView.ts`'s summary before any run. */
const NO_RESULTS = "No test results yet.";

/** Upstream `SUMMARY_RENDER_INTERVAL`: the summary of a run in progress is redrawn this often. */
export const SUMMARY_RENDER_INTERVAL = 200;

/** Upstream `testing.searchForTestExtension` welcome entries (`testing.contribution.ts`). */
const WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "No tests have been found in this workspace yet." },
    { kind: "text", text: "" },
    { kind: "button", label: "Install Additional Test Extensions...", command: "testing.searchForTestExtension" },
];

/** Upstream `testingStatesToIcons` with `testStatesToIconColors`; Running is the spinner. */
const STATE_ICONS: Readonly<
    Record<Exclude<TestResultState, typeof TestResultState.Running>, { icon: IProductIcon; color: string }>
> = {
    [TestResultState.Errored]: { icon: codicon("issues"), color: "testing.iconErrored" },
    [TestResultState.Failed]: { icon: codicon("error"), color: "testing.iconFailed" },
    [TestResultState.Passed]: { icon: codicon("pass"), color: "testing.iconPassed" },
    [TestResultState.Queued]: { icon: codicon("history"), color: "testing.iconQueued" },
    [TestResultState.Skipped]: { icon: codicon("debug-step-over"), color: "testing.iconSkipped" },
    [TestResultState.Unset]: { icon: codicon("circle-outline"), color: "testing.iconUnset" },
};
const FILTER_ICON = codicon("filter");
/** Upstream `testingRerunIcon`. */
const RERUN_ICON = codicon("debug-rerun");

/** Upstream `testFilterDescriptions` of the terms "More Filters..." offers. */
const MORE_FILTERS: readonly { readonly term: TestFilterTerm; readonly label: string }[] = [
    { term: TestFilterTerm.Failed, label: "Show Only Failed Tests" },
    { term: TestFilterTerm.Executed, label: "Show Only Executed Tests" },
];

/** A row of the tree: a test, or upstream's `TestTreeErrorMessage` under a test with `error`. */
export interface ITestRow {
    readonly kind: "test" | "error";
    /** The test's id; the error row's test. */
    readonly testId: string;
    /** The mirror's node, updated in place by the diffs: a row the next diff removed still draws. */
    readonly node: ITestNode;
}

/** Upstream `TestItemTreeElement.state` and `duration`: computed from the results over the mirror. */
interface IComputedTestState {
    readonly state: TestResultState;
    readonly duration: number | undefined;
}

/**
 * Upstream `TestingExplorerView` with the hierarchical projection: a container in the sidebar while some controller is
 * registered, the welcome while no controller has tests, otherwise a filter, the results summary and the tree.
 * Rows are mirrored from {@link TestService}, their states from {@link TestResultService}: an update keeps the
 * expansion and the cursor by test id.
 */
export class TestingExplorerComponent extends Component {
    public static dependencies = [
        TestServiceDIToken,
        TestResultServiceDIToken,
        ViewsServiceDIToken,
        ContextKeyServiceDIToken,
        ProductIconServiceDIToken,
        ProgressServiceDIToken,
        MenuServiceDIToken,
        MenuRegistryDIToken,
        ContextMenuServiceDIToken,
        CommandRegistryDIToken,
        IConfigurationServiceDIToken,
        StateServiceDIToken,
        TestingRevealTargetDIToken,
        JumpRecorderDIToken,
        NotificationServiceDIToken,
    ] as const;

    public readonly view: TUIElement;
    public readonly tree: TreeViewElement<ITestRow>;
    public readonly filterInput = new InputElement();
    /** For Collapse All: the tree keeps its expansion private. */
    private readonly expanded = new Map<string, ITestRow>();
    /** Tests already shown once: a controller root and a test with an error expand when they first appear. */
    private readonly seen = new Set<string>();
    private filter: ITestExplorerFilter = parseTestExplorerFilter("");
    /** Tests the filter shows (`TreeVisibility.Visible`/`Recurse` with a visible descendant); `null` — no filter. */
    private visible: ReadonlySet<string> | null = null;
    /** Tests the filter matched themselves (`TreeVisibility.Visible`): what Run Tests runs under a filter. */
    private included: ReadonlySet<string> = new Set();
    /** Tests asked to resolve, until the request settles (its diff has come by then): upstream's `expandPromises`. */
    private readonly resolving = new Set<string>();
    /** While some test is busy or a run goes on: ends the view's progress and the spinner ticks. */
    private busy: IDisposable | null = null;
    private readonly inlineActions = new Map<string, ITreeItemAction[]>();
    /** The key of the tree's first row, from the last read of the roots. */
    private firstRowKey: string | undefined;
    /** The computed states of one read of the tree; a change of the results drops them. */
    private readonly states = new Map<string, IComputedTestState>();
    private sorting: TestExplorerViewSorting;
    private readonly summaryStatus = new TextLabelElement("");
    private readonly summaryText = new TextLabelElement(NO_RESULTS);
    private readonly summaryRerun = new TextLabelElement("");
    /** Upstream `renderLoop`: a run in progress redraws the summary at most this often. */
    private readonly summaryLoop = this.register(
        new RunOnceScheduler(() => {
            this.renderSummary();
        }, SUMMARY_RENDER_INTERVAL),
    );

    public constructor(
        private readonly tests: TestService,
        private readonly results: TestResultService,
        private readonly views: ViewsService,
        private readonly contextKeys: ContextKeyService,
        private readonly icons: IProductIconService,
        private readonly progress: ProgressService,
        private readonly menus: MenuService,
        menuRegistry: MenuRegistry,
        private readonly contextMenu: ContextMenuService,
        private readonly commands: CommandRegistry,
        private readonly configuration: IConfigurationService,
        private readonly stateService: IStateService,
        private readonly revealTarget: IRevealLocationTarget,
        private readonly jumps: IJumpRecorder,
        private readonly notifications: NotificationService,
    ) {
        super();
        this.sorting = stateService.get(TESTING_VIEW_SORTING_STATE);
        contextKeys.set("testing.explorerViewSorting", this.sorting);
        const provider: ITreeDataProvider<ITestRow> = {
            getTreeItem: (row) => this.toTreeItem(row),
            getChildren: (row) => this.childrenOf(row),
            getKey: (row) => rowKey(row),
        };
        this.tree = new TreeViewElement(provider, {
            leftPadding: 1,
            // The approved demo: the glyphs keep a column off the edge, as in Explorer.
            inlineActionsRightPadding: 1,
            expandOnlyOnTwistieClick: () => configuration.get("workbench.tree.expandMode") === "doubleClick",
            openOnSingleClick: () => configuration.get("workbench.list.openMode") !== "doubleClick",
            renderIndentGuides: treeIndentGuides(configuration),
        });
        this.tree.id = "testingExplorerTree";
        this.tree.onExpandedChanged = (row, isExpanded) => {
            if (!isExpanded) {
                this.expanded.delete(rowKey(row));
                return;
            }
            this.expanded.set(rowKey(row), row);
            // An error row is no folder: only tests expand.
            this.resolve(row.node);
        };
        // Upstream `onDidOpen`: a leaf with a location opens it, the keyboard stays in the tree.
        this.tree.onActivate = (row) => {
            if (row.kind === "error" || row.node.children.size > 0) return;
            this.goToTest(row.testId, true);
        };
        this.tree.onContextMenu = (row, screenX, screenY) => {
            this.showContextMenu(row, screenX, screenY);
        };
        this.tree.onInlineAction = (row, index) => {
            const entry = inlineMenuEntries(this.itemMenu(row, true)).at(index);
            // A glyph drawn before the menu changed.
            if (entry !== undefined) this.runEntry(entry, row);
        };
        this.tree.addEventListener("keydown", (event) => {
            if (event.key !== "ArrowUp" || hasModifier(event)) return;
            const selected = this.tree.getSelectedNode();
            if (selected === null || rowKey(selected) !== this.firstRowKey) return;
            event.preventDefault();
            this.filterInput.focus();
        });

        this.filterInput.placeholder = "Filter (e.g. text, !exclude, @tag)";
        this.filterInput.onChange = (value) => {
            this.setFilter(value);
        };
        this.filterInput.addEventListener("keydown", (event) => {
            if (hasModifier(event)) return;
            if (event.key === "ArrowDown") {
                event.preventDefault();
                this.tree.focus();
            } else if (event.key === "Escape" && this.filterInput.inputState.value !== "") {
                // The second Escape has nothing to clear: it goes on as in Search.
                event.preventDefault();
                this.setFilterText("");
            }
        });
        const filterGlyph = new TextLabelElement(icons.glyph(FILTER_ICON));
        filterGlyph.id = "testingMoreFilters";
        // Upstream's "More Filters..." button.
        filterGlyph.addEventListener("click", (event) => {
            event.preventDefault();
            this.showMoreFilters(event.screenX, event.screenY + 1);
        });
        const filterRow = new HFlexElement();
        filterRow.addChild(this.filterInput, { width: hflexFill(), height: 1 });
        filterRow.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        filterRow.addChild(filterGlyph, { width: hflexFit(), height: 1 });
        this.summaryRerun.id = "testingRerunLastRun";
        this.summaryRerun.addEventListener("click", (event) => {
            event.preventDefault();
            this.execute("testing.reRunLastRun");
        });
        const summary = new HFlexElement();
        summary.addChild(this.summaryStatus, { width: hflexFit(), height: 1 });
        summary.addChild(this.summaryText, { width: hflexFill(), height: 1 });
        summary.addChild(this.summaryRerun, { width: hflexFit(), height: 1 });
        const header = new VStackElement();
        for (const row of [filterRow, summary]) row.layoutStyle = { width: "fill", height: 1 };
        header.replaceChildren([filterRow, summary]);
        const scrollBars = new ScrollBarDecorator(this.tree);
        const root = new HeaderBodyViewElement(new PaddingContainerElement(header, { left: 1, right: 1 }), scrollBars);
        root.id = "testingExplorerView";
        this.view = root;

        views.registerContainer({
            id: TESTING_VIEWLET_ID,
            title: "TESTING",
            label: "Testing",
            // Stryker disable next-line StringLiteral: ViewsService only distinguishes "panel"; any other value goes to the sidebar
            location: "sidebar",
            // Upstream `order: 6`: after Extensions and References.
            order: 6,
        });
        const refreshLater = (): void => {
            void this.refresh().catch(onUnexpectedError);
        };
        this.register(tests.onDidProcessDiff(refreshLater));
        this.register(
            results.onTestChanged((change) => {
                this.followRunningTest(change);
                if (change.reason !== "message") refreshLater();
            }),
        );
        this.register(
            results.onResultsChanged((event) => {
                this.renderSummary();
                refreshLater();
                if ("completed" in event) this.revealFailed(event.completed);
            }),
        );
        this.register(
            views.onDidChangeViewExpanded(() => {
                this.resolveRootsIfShown();
            }),
        );
        this.register(
            icons.onDidChange(() => {
                this.renderSummary();
                refreshLater();
            }),
        );
        this.register(
            stateService.onDidOpenWorkspace(() => {
                this.setSorting(stateService.get(TESTING_VIEW_SORTING_STATE));
            }),
        );
        let menuContexts: ReadonlySet<string> | null = null;
        this.register(
            menuRegistry.onDidChangeMenu(() => {
                menuContexts = null;
                refreshLater();
            }),
        );
        this.register(
            contextKeys.onDidChange((changed) => {
                this.syncRegistration();
                menuContexts ??= menuRegistry.getMenuContexts(MenuId.TestItem);
                for (const key of changed) {
                    // Stryker disable next-line ConditionalExpression,BooleanLiteral: equivalent — a refresh on a key no item reads draws the same rows; the filter only saves the work
                    if (!menuContexts.has(key)) continue;
                    refreshLater();
                    return;
                }
            }),
        );
        this.register(
            onDidChangeTreeIndentGuides(configuration, () => {
                this.tree.markDirty();
            }),
        );
        this.register({
            dispose: () => {
                this.setBusy(false);
            },
        });
        this.syncRegistration();
        this.renderSummary();
    }

    /** Upstream `CollapseAllAction`. */
    public async collapseAll(): Promise<void> {
        for (const row of [...this.expanded.values()]) await this.tree.toggleExpand(row);
    }

    /** The test of the row under the cursor, `undefined` on an empty tree. */
    public get focusedTestId(): string | undefined {
        return this.tree.getSelectedNode()?.testId;
    }

    public get viewSorting(): TestExplorerViewSorting {
        return this.sorting;
    }

    /** Upstream `viewSorting`'s setter: kept in the workspace. */
    public setSorting(sorting: TestExplorerViewSorting): void {
        if (sorting === this.sorting) return;
        this.sorting = sorting;
        this.contextKeys.set("testing.explorerViewSorting", sorting);
        this.stateService.store(TESTING_VIEW_SORTING_STATE, sorting);
        void this.tree.refresh().catch(onUnexpectedError);
    }

    /** Upstream `isFilteringFor`. */
    public isFilteringFor(term: TestFilterTerm): boolean {
        return this.filter.terms.has(term);
    }

    /** Upstream `toggleFilteringFor`: the term goes into the filter's text or out of it. */
    public toggleFilteringFor(term: TestFilterTerm): void {
        this.setFilterText(toggleFilterTerm(this.filterInput.inputState.value, term, !this.isFilteringFor(term)));
    }

    /**
     * Upstream `getTreeIncludeExclude` over the visible tests: `within` (the whole tree by default) minus the
     * descendants the filter hides; for the whole tree under a filter, the tests it matched themselves.
     */
    public getTreeIncludeExclude(within?: readonly ITestNode[]): { include: ITestNode[]; exclude: ITestNode[] } {
        const visible = this.visible;
        if (visible === null) return { include: [...(within ?? this.tests.rootItems)], exclude: [] };
        const include: ITestNode[] = [];
        const exclude: ITestNode[] = [];
        const attempt = (node: ITestNode, alreadyIncluded: boolean): void => {
            if (!visible.has(node.item.extId)) {
                if (alreadyIncluded) exclude.push(node);
                return;
            }
            const includeHere = !alreadyIncluded && this.included.has(node.item.extId);
            if (includeHere) include.push(node);
            for (const child of this.childNodes(node)) attempt(child, alreadyIncluded || includeHere);
        };
        if (within === undefined) {
            for (const root of this.tests.rootItems) attempt(root, false);
            return { include, exclude };
        }
        for (const node of within) {
            for (const child of this.childNodes(node)) attempt(child, true);
        }
        return { include: [...within], exclude };
    }

    /**
     * Upstream `vscode.revealTest`: opens the test's file at the start of its range. `preserveFocus` keeps the keyboard
     * in the tree.
     */
    public goToTest(testId: string, preserveFocus: boolean): void {
        const item = this.tests.getNodeById(testId)?.item;
        if (item?.uri === undefined) return;
        const start = item.range?.start ?? { line: 0, character: 0 };
        revealLocation(
            this.revealTarget,
            this.jumps,
            item.uri,
            createRange(start.line, start.character, start.line, start.character),
        );
        if (preserveFocus) this.tree.focus();
    }

    private isRegistered(): boolean {
        return this.views.getViewContainerByViewId(TESTING_EXPLORER_VIEW_ID) !== null;
    }

    private syncRegistration(): void {
        const shown = this.contextKeys.evaluate(VIEW_WHEN);
        if (shown === this.isRegistered()) return;
        if (!shown) {
            this.views.unregisterView(TESTING_EXPLORER_VIEW_ID);
            return;
        }
        this.views.registerView({
            id: TESTING_EXPLORER_VIEW_ID,
            containerId: TESTING_VIEWLET_ID,
            title: "TEST EXPLORER",
            order: 10,
            body: this.body(),
            placeholder: WELCOME,
            canMoveView: true,
            focus: () => {
                this.filterInput.focus();
            },
        });
    }

    /** Upstream `testCollectionIsEmpty` while no controller is busy: the welcome (`null`), otherwise the tree. */
    private body(): TUIElement | null {
        const empty = this.tests.rootItems.every((root) => root.children.size === 0 && !isBusy(root));
        return empty ? null : this.view;
    }

    /** After a diff and anything the rows show: the mirror is read anew. */
    private async refresh(): Promise<void> {
        this.inlineActions.clear();
        this.states.clear();
        for (const testId of this.seen) {
            if (this.tests.getNodeById(testId) === undefined) this.seen.delete(testId);
        }
        this.setBusy(this.isRunning() || this.tests.rootItems.some((root) => this.anyBusy(root)));
        this.updateVisibility();
        this.views.setViewBody(TESTING_EXPLORER_VIEW_ID, this.body());
        this.resolveRootsIfShown();
        await this.tree.refresh();
    }

    private isRunning(): boolean {
        return this.results.results.some((result) => result.completedAt === undefined);
    }

    /** Upstream `storeItem`: a controller's root resolves as soon as the view shows it. */
    private resolveRootsIfShown(): void {
        if (!this.isRegistered() || !this.views.isViewExpanded(TESTING_EXPLORER_VIEW_ID)) return;
        for (const root of this.tests.rootItems) this.resolve(root);
    }

    private resolve(node: ITestNode): void {
        const testId = node.item.extId;
        if (this.resolving.has(testId) || node.expand !== TestItemExpandState.Expandable) return;
        this.resolving.add(testId);
        void this.tests.expandTest(testId, 0).finally(() => this.resolving.delete(testId));
    }

    private setFilterText(text: string): void {
        this.filterInput.inputState.value = text;
        this.filterInput.markDirty();
        this.setFilter(text);
    }

    private setFilter(text: string): void {
        this.filter = parseTestExplorerFilter(text);
        void this.revealIncluded(this.updateVisibility()).catch(onUnexpectedError);
    }

    /** Upstream: a filter change expands the tree to every test it matched (ancestors first or not: the tree waits). */
    private async revealIncluded(ancestors: readonly ITestNode[]): Promise<void> {
        await this.tree.refresh();
        await this.tree.expandElements(ancestors.map((node) => testRow(node)));
    }

    /** Upstream `TestsFilter` over the whole mirror; returns the ancestors of what matched itself (upstream `lastIncludedTests`). */
    private updateVisibility(): ITestNode[] {
        const ancestors = new Map<string, ITestNode>();
        if (isEmptyFilter(this.filter)) {
            this.visible = null;
            this.included = new Set();
            return [];
        }
        const visible = new Set<string>();
        const included = new Set<string>();
        const visit = (node: ITestNode, lineage: ITestNode[]): boolean => {
            const chain = [node, ...lineage];
            const result = filterTest(
                this.filter,
                chain.map((test) => test.item),
                this.stateOf(node).state,
            );
            if (result === FilterResult.Exclude) return false;
            // Upstream's error row is always visible, and so is its test.
            let shown = result === FilterResult.Include || node.item.error !== null;
            for (const child of this.childNodes(node)) {
                if (visit(child, chain)) shown = true;
            }
            if (result === FilterResult.Include) {
                included.add(node.item.extId);
                for (const ancestor of lineage) ancestors.set(ancestor.item.extId, ancestor);
            }
            if (shown) visible.add(node.item.extId);
            return shown;
        };
        for (const root of this.tests.rootItems) visit(root, []);
        this.visible = visible;
        this.included = included;
        return [...ancestors.values()];
    }

    /** Upstream `getChildrenForParent`: with one controller that has tests, its tests are the roots. */
    private childrenOf(row: ITestRow | undefined): ITestRow[] {
        let parent: ITestNode | undefined = row?.node;
        let nodes: ITestNode[];
        if (parent === undefined) {
            const roots = this.tests.rootItems.filter((root) => root.children.size > 0 || root.item.error !== null);
            if (roots.length === 1) parent = roots[0];
            nodes = parent === undefined ? roots : this.childNodes(parent);
        } else {
            nodes = this.childNodes(parent);
        }
        const visible = this.visible;
        const shown = visible === null ? nodes : nodes.filter((node) => visible.has(node.item.extId));
        shown.sort((a, b) => this.compareTests(a, b));
        const result = shown.map((node) => testRow(node));
        if (parent !== undefined && parent.item.error !== null)
            result.unshift({ kind: "error", testId: parent.item.extId, node: parent });
        if (row === undefined) this.firstRowKey = result.length === 0 ? undefined : rowKey(result[0]);
        this.expandOnFirstSight(row === undefined ? shown : shown.filter((node) => node.item.error !== null));
        return result;
    }

    private childNodes(node: ITestNode): ITestNode[] {
        // `TestService` drops a child from its parent together with the child: every child id is in the mirror.
        return [...node.children].map((childId) => assertReturnsDefined(this.tests.getNodeById(childId)));
    }

    /** Upstream `PreserveOrExpanded` of a controller root and of a test with an error, once: the user's choice stays. */
    private expandOnFirstSight(nodes: readonly ITestNode[]): void {
        const fresh = nodes.filter((node) => {
            const isFresh = !this.seen.has(node.item.extId);
            this.seen.add(node.item.extId);
            return isFresh && (TestId.parentId(node.item.extId) === undefined || node.item.error !== null);
        });
        // After the tree has taken these children: it expands a row it already lists.
        queueMicrotask(() => {
            void this.tree.expandElements(fresh.map((node) => testRow(node)));
        });
    }

    /**
     * Upstream `TreeProjection`'s computed state: the latest result's own state raised by the children's; a test
     * without children in the mirror trusts the result's computed state. The duration is the own one, otherwise the
     * children's sum (upstream `getComputedDuration`).
     */
    private stateOf(node: ITestNode): IComputedTestState {
        const testId = node.item.extId;
        const cached = this.states.get(testId);
        if (cached !== undefined) return cached;
        const own = this.results.getStateById(testId)?.[1];
        let computed: IComputedTestState;
        if (node.children.size === 0) {
            computed = { state: own?.computedState ?? TestResultState.Unset, duration: own?.ownDuration };
        } else {
            const children = this.childNodes(node).map((child) => this.stateOf(child));
            let duration = own?.ownDuration;
            if (duration === undefined) {
                for (const child of children) {
                    if (child.duration !== undefined) duration = (duration ?? 0) + child.duration;
                }
            }
            computed = {
                state: computeState(
                    own?.ownComputedState ?? TestResultState.Unset,
                    children.map((child) => child.state),
                ),
                duration,
            };
        }
        this.states.set(testId, computed);
        return computed;
    }

    /** Upstream `TreeSorter`. */
    private compareTests(a: ITestNode, b: ITestNode): number {
        const stateA = this.stateOf(a);
        const stateB = this.stateOf(b);
        const durationDelta = (stateB.duration ?? 0) - (stateA.duration ?? 0);
        if (this.sorting === "duration" && durationDelta !== 0) return durationDelta;
        const stateDelta = statePriority[stateB.state] - statePriority[stateA.state];
        if (this.sorting === "status" && stateDelta !== 0) return stateDelta;
        const rangeA = a.item.range;
        const rangeB = b.item.range;
        let inSameLocation = false;
        if (a.item.uri !== undefined && a.item.uri === b.item.uri && rangeA !== null && rangeB !== null) {
            inSameLocation = true;
            const delta = rangeA.start.line - rangeB.start.line;
            if (delta !== 0) return delta;
        }
        const sa = a.item.sortText;
        const sb = b.item.sortText;
        // In the same location without a sortText the extension's order stays (upstream #163449).
        if (inSameLocation && sa === null && sb === null) return 0;
        return (sa ?? a.item.label).localeCompare(sb ?? b.item.label);
    }

    private toTreeItem(row: ITestRow): ITreeItem {
        const { node } = row;
        if (row.kind === "error") {
            // An error row is listed only while its test has an error.
            return { label: String(node.item.error), collapsible: false, labelColor: "list.errorForeground" };
        }
        const { state, duration } = this.stateOf(node);
        const spinning = isBusy(node) || state === TestResultState.Running;
        const icon = spinning ? undefined : STATE_ICONS[state];
        let description = node.item.description ?? undefined;
        if (duration !== undefined) {
            description =
                description === undefined ? formatDuration(duration) : `${description}: ${formatDuration(duration)}`;
        }
        return {
            label: node.item.label,
            icon: icon === undefined ? this.spinnerFrame() : this.icons.glyph(icon.icon),
            iconColor: icon?.color,
            collapsible:
                node.children.size > 0 || node.item.error !== null || node.expand !== TestItemExpandState.NotExpandable,
            description,
            actions: this.inlineActionsOf(row),
        };
    }

    /** The shared clock of `ProgressService`; before its show delay — the first frame. */
    private spinnerFrame(): string {
        return this.progress.viewProgress().get(TESTING_EXPLORER_VIEW_ID)?.spinner ?? SPINNER_FRAMES[0];
    }

    private anyBusy(node: ITestNode): boolean {
        return isBusy(node) || this.childNodes(node).some((child) => this.anyBusy(child));
    }

    /** While some test is busy or a run goes on the view has a progress entry: its ticks redraw the row spinners. */
    private setBusy(busy: boolean): void {
        if (busy === (this.busy !== null)) return;
        if (this.busy !== null) {
            this.busy.dispose();
            this.busy = null;
            return;
        }
        let end!: () => void;
        const ended = new Promise<void>((resolve) => {
            end = resolve;
        });
        void this.progress.withProgress(
            // Stryker disable next-line StringLiteral: a view's progress draws only its spinner, not the title
            { location: "view", viewId: TESTING_EXPLORER_VIEW_ID, title: "Testing" },
            () => ended,
        );
        const ticks = this.progress.onDidChange(() => {
            void this.tree.refresh().catch(onUnexpectedError);
        });
        this.busy = {
            dispose: () => {
                ticks.dispose();
                end();
            },
        };
    }

    /**
     * Upstream `ResultSummaryView`: before any run "No test results yet."; during one the spinner, the passed of the
     * live runs' count and the time since the oldest live one started, redrawn every {@link SUMMARY_RENDER_INTERVAL};
     * after it the dominant state of the latest run, its count, its duration and Rerun Last Run on the right.
     */
    private renderSummary(): void {
        const { results } = this.results;
        if (results.length === 0) {
            this.summaryStatus.setText("");
            this.summaryText.setText(NO_RESULTS);
            this.summaryRerun.setText("");
            return;
        }
        const live = results.filter((result) => result.completedAt === undefined);
        let status: string;
        let color: string | undefined;
        let duration: string;
        if (live.length > 0) {
            status = this.spinnerFrame();
            duration = formatDuration(this.results.now() - live[live.length - 1].startedAt);
            this.summaryLoop.schedule();
        } else {
            const last = results[0];
            const dominant = statesInOrder.find((state) => last.counts[state] > 0) ?? TestResultState.Unset;
            const icon = STATE_ICONS[dominant as keyof typeof STATE_ICONS];
            status = this.icons.glyph(icon.icon);
            color = icon.color;
            duration = formatDuration(assertReturnsDefined(last.completedAt) - last.startedAt);
        }
        const { passed, totalWillBeRun } = countStates(live.length > 0 ? live : [results[0]]);
        this.summaryStatus.setText(`${status} `);
        this.summaryStatus.clearCharStyles();
        if (color !== undefined) this.summaryStatus.setCharStyle(0, { fg: color });
        this.summaryText.setText(`${String(passed)}/${String(totalWillBeRun)} ${duration}`);
        this.summaryRerun.setText(live.length > 0 ? "" : this.icons.glyph(RERUN_ICON));
    }

    /** After a run its failed tests are revealed: their ancestors expand. */
    private revealFailed(result: LiveTestResult): void {
        const ancestors: ITestRow[] = [];
        for (const test of result.tests) {
            if (!isFailedState(test.ownComputedState)) continue;
            for (let id = TestId.parentId(test.item.extId); id !== undefined; id = TestId.parentId(id)) {
                const node = this.tests.getNodeById(id);
                if (node !== undefined) ancestors.push(testRow(node));
            }
        }
        if (ancestors.length === 0) return;
        void this.tree
            .refresh()
            .then(() => this.tree.expandElements(ancestors.reverse()))
            .catch(onUnexpectedError);
    }

    /**
     * Upstream `testing.followRunningTest`: the cursor follows a test that starts (or finishes straight from the queue);
     * `testing.alwaysRevealTestOnStateChange` expands the tree to it, otherwise only to a failed one and the cursor
     * stops at its nearest shown ancestor.
     */
    private followRunningTest(change: ITestResultItemChange): void {
        if (change.reason !== "ownState" || !this.configuration.get("testing.followRunningTest")) return;
        const { ownComputedState: state } = change.item;
        if (state !== TestResultState.Running && !isStateWithResult(state)) return;
        const expand = this.configuration.get("testing.alwaysRevealTestOnStateChange") || isFailedState(state);
        const chain: ITestRow[] = [];
        for (let id: string | undefined = change.item.item.extId; id !== undefined; id = TestId.parentId(id)) {
            const node = this.tests.getNodeById(id);
            if (node !== undefined) chain.unshift(testRow(node));
        }
        // The single controller's root is no row.
        if (this.tests.rootItems.filter((root) => root.children.size > 0).length === 1) chain.shift();
        let target = chain;
        if (!expand) {
            const collapsed = chain.findIndex(
                (row, index) => index < chain.length - 1 && !this.expanded.has(rowKey(row)),
            );
            if (collapsed !== -1) target = chain.slice(0, collapsed + 1);
        }
        if (target.length > 0) void this.tree.reveal(target).catch(onUnexpectedError);
    }

    /** Upstream `TestingExplorerFilter`'s "More Filters..." menu under the filter glyph. */
    private showMoreFilters(screenX: number, screenY: number): void {
        const entries: MenuEntry[] = MORE_FILTERS.map(({ term, label }) => ({
            label,
            icon: this.isFilteringFor(term) ? CHECKED_ICON : undefined,
            onSelect: () => {
                this.toggleFilteringFor(term);
            },
        }));
        this.contextMenu.showContextMenu({
            getOwner: () => this.filterInput,
            getAnchor: () => ({ screenX, screenY }),
            getEntries: () => entries,
        });
    }

    /** The glyphs of a row, resolved once per refresh: a spinner tick redraws every row. */
    private inlineActionsOf(row: ITestRow): ITreeItemAction[] {
        let actions = this.inlineActions.get(row.testId);
        // Stryker disable next-line ConditionalExpression: equivalent — resolving the menu again gives the same glyphs; the cache only saves the work
        if (actions === undefined) {
            actions = inlineMenuActions(this.itemMenu(row, true));
            this.inlineActions.set(row.testId, actions);
        }
        return actions;
    }

    /** Upstream `getActionableElementActions`: the row's keys on top of the global ones. */
    private itemMenu(row: ITestRow, inline: boolean): IMenuEntryGroup[] {
        if (row.kind === "error") return [];
        const keys: MenuContextKeys = {
            view: TESTING_EXPLORER_VIEW_ID,
            testId: TestId.localId(row.testId),
            controllerId: row.node.controllerId,
            "testing.testItemHasUri": row.node.item.uri !== undefined,
        };
        return this.menus
            .getEntryGroups(MenuId.TestItem, undefined, keys)
            .filter((group) => (group.group === INLINE_MENU_GROUP) === inline);
    }

    private showContextMenu(row: ITestRow, screenX: number, screenY: number): void {
        const entries: MenuEntry[] = joinMenuGroups(this.itemMenu(row, false)).map((entry) =>
            bindMenuEntry(entry, (item) => {
                this.runEntry(item, row);
            }),
        );
        if (entries.length === 0) return;
        this.contextMenu.showContextMenu({
            getOwner: () => this.tree,
            getAnchor: () => ({ screenX, screenY }),
            getEntries: () => entries,
        });
    }

    /** The command gets the row's test: the subprocess turns it back into the extension's `TestItem`. */
    private runEntry(entry: MenuItemEntry, row: ITestRow): void {
        const arg: IWireTestItemArg = { $testId: row.testId };
        runMenuEntry(entry, (id) => this.commands.execute(id, arg), this.showError);
    }

    private execute(id: string): void {
        runMenuEntry({ label: id, id }, (commandId) => this.commands.execute(commandId), this.showError);
    }

    private readonly showError = (message: string): void => {
        this.notifications.show({ severity: "error", message, modal: false, items: [] });
    };
}

function testRow(node: ITestNode): ITestRow {
    return { kind: "test", testId: node.item.extId, node };
}

/** The error row has a key apart from its test's. */
function rowKey(row: ITestRow): string {
    return `${row.kind}:${row.testId}`;
}

function hasModifier(event: {
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
}): boolean {
    return event.ctrlKey || event.altKey || event.shiftKey;
}

function isBusy(node: ITestNode): boolean {
    return node.item.busy || node.expand === TestItemExpandState.BusyExpanding;
}

/** Upstream `collectTestStateCounts`. */
function countStates(results: readonly LiveTestResult[]): { passed: number; totalWillBeRun: number } {
    let passed = 0;
    let other = 0;
    for (const { counts } of results) {
        passed += counts[TestResultState.Passed];
        other +=
            counts[TestResultState.Errored] +
            counts[TestResultState.Failed] +
            counts[TestResultState.Queued] +
            counts[TestResultState.Running];
    }
    return { passed, totalWillBeRun: passed + other };
}
