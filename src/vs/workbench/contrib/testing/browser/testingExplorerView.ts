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
import { codicon } from "../../../../base/common/codicons.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import {
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
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import { type IWireTestItemArg, TestId, TestItemExpandState } from "../../../api/common/testingWireTypes.ts";
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
} from "../common/testExplorerFilter.ts";
import { type ITestNode, type TestService, TestServiceDIToken } from "../common/testService.ts";

/** Upstream `Testing.ViewletId`. */
export const TESTING_VIEWLET_ID = "workbench.view.extension.test";
/** Upstream `Testing.ExplorerViewId`. */
export const TESTING_EXPLORER_VIEW_ID = "workbench.view.testing";

export const TestingRevealTargetDIToken = token<IRevealLocationTarget>("TestingRevealTarget");
export const TestingExplorerComponentDIToken = token<TestingExplorerComponent>("TestingExplorerComponent");

/** Upstream's view `when`: the container shows while some extension has a controller. */
const VIEW_WHEN = "testing.providerCount > 0";

/** `testingExplorerView.ts`'s summary before any run. */
const NO_RESULTS = "No test results yet.";

/** Upstream `testing.searchForTestExtension` welcome entries (`testing.contribution.ts`). */
const WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "No tests have been found in this workspace yet." },
    { kind: "text", text: "" },
    { kind: "button", label: "Install Additional Test Extensions...", command: "testing.searchForTestExtension" },
];

/** Upstream `testingStatesToIcons` for `Unset`: no runs yet, every test is in it. */
const UNSET_ICON = codicon("circle-outline");
const FILTER_ICON = codicon("filter");

/** A row of the tree: a test, or upstream's `TestTreeErrorMessage` under a test with `error`. */
export interface ITestRow {
    readonly kind: "test" | "error";
    /** The test's id; the error row's test. */
    readonly testId: string;
    /** The mirror's node, updated in place by the diffs: a row the next diff removed still draws. */
    readonly node: ITestNode;
}

/**
 * Upstream `TestingExplorerView` with the hierarchical projection: a container in the sidebar while some controller is
 * registered, the welcome while no controller has tests, otherwise a filter, the results summary and the tree.
 * Rows are mirrored from {@link TestService}: an update keeps the expansion and the cursor by test id.
 */
export class TestingExplorerComponent extends Component {
    public static dependencies = [
        TestServiceDIToken,
        ViewsServiceDIToken,
        ContextKeyServiceDIToken,
        ProductIconServiceDIToken,
        ProgressServiceDIToken,
        MenuServiceDIToken,
        MenuRegistryDIToken,
        ContextMenuServiceDIToken,
        CommandRegistryDIToken,
        IConfigurationServiceDIToken,
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
    /** Tests asked to resolve, until the request settles (its diff has come by then): upstream's `expandPromises`. */
    private readonly resolving = new Set<string>();
    /** While some test is busy: ends the view's progress and the spinner ticks. */
    private busy: IDisposable | null = null;
    private readonly inlineActions = new Map<string, ITreeItemAction[]>();
    /** The key of the tree's first row, from the last read of the roots. */
    private firstRowKey: string | undefined;

    public constructor(
        private readonly tests: TestService,
        private readonly views: ViewsService,
        private readonly contextKeys: ContextKeyService,
        private readonly icons: IProductIconService,
        private readonly progress: ProgressService,
        private readonly menus: MenuService,
        menuRegistry: MenuRegistry,
        private readonly contextMenu: ContextMenuService,
        private readonly commands: CommandRegistry,
        configuration: IConfigurationService,
        private readonly revealTarget: IRevealLocationTarget,
        private readonly jumps: IJumpRecorder,
        private readonly notifications: NotificationService,
    ) {
        super();
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
                this.filterInput.inputState.value = "";
                this.setFilter("");
            }
        });
        const filterGlyph = new TextLabelElement(icons.glyph(FILTER_ICON));
        const filterRow = new HFlexElement();
        filterRow.addChild(this.filterInput, { width: hflexFill(), height: 1 });
        filterRow.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        filterRow.addChild(filterGlyph, { width: hflexFit(), height: 1 });
        const summary = new TextLabelElement(NO_RESULTS);
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
        this.register(
            tests.onDidProcessDiff(() => {
                void this.refresh().catch(onUnexpectedError);
            }),
        );
        this.register(
            views.onDidChangeViewExpanded(() => {
                this.resolveRootsIfShown();
            }),
        );
        this.register(
            icons.onDidChange(() => {
                void this.refresh().catch(onUnexpectedError);
            }),
        );
        let menuContexts: ReadonlySet<string> | null = null;
        this.register(
            menuRegistry.onDidChangeMenu(() => {
                menuContexts = null;
                void this.refresh().catch(onUnexpectedError);
            }),
        );
        this.register(
            contextKeys.onDidChange((changed) => {
                this.syncRegistration();
                menuContexts ??= menuRegistry.getMenuContexts(MenuId.TestItem);
                for (const key of changed) {
                    // Stryker disable next-line ConditionalExpression,BooleanLiteral: equivalent — a refresh on a key no item reads draws the same rows; the filter only saves the work
                    if (!menuContexts.has(key)) continue;
                    void this.refresh().catch(onUnexpectedError);
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
    }

    /** Upstream `CollapseAllAction`. */
    public async collapseAll(): Promise<void> {
        for (const row of [...this.expanded.values()]) await this.tree.toggleExpand(row);
    }

    /** The test of the row under the cursor, `undefined` on an empty tree. */
    public get focusedTestId(): string | undefined {
        return this.tree.getSelectedNode()?.testId;
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
        for (const testId of this.seen) {
            if (this.tests.getNodeById(testId) === undefined) this.seen.delete(testId);
        }
        this.setBusy(this.tests.rootItems.some((root) => this.anyBusy(root)));
        this.updateVisibility();
        this.views.setViewBody(TESTING_EXPLORER_VIEW_ID, this.body());
        this.resolveRootsIfShown();
        await this.tree.refresh();
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
            return [];
        }
        const visible = new Set<string>();
        const visit = (node: ITestNode, lineage: ITestNode[]): boolean => {
            const chain = [node, ...lineage];
            const result = filterTest(
                this.filter,
                chain.map((test) => test.item),
            );
            if (result === FilterResult.Exclude) return false;
            // Upstream's error row is always visible, and so is its test.
            let shown = result === FilterResult.Include || node.item.error !== null;
            for (const child of this.childNodes(node)) {
                if (visit(child, chain)) shown = true;
            }
            // Stryker disable next-line ConditionalExpression: equivalent — a test that only inherits is an ancestor of a match, expanded for it anyway
            if (result === FilterResult.Include)
                for (const ancestor of lineage) ancestors.set(ancestor.item.extId, ancestor);
            if (shown) visible.add(node.item.extId);
            return shown;
        };
        for (const root of this.tests.rootItems) visit(root, []);
        this.visible = visible;
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
        shown.sort(compareTests);
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

    private toTreeItem(row: ITestRow): ITreeItem {
        const { node } = row;
        if (row.kind === "error") {
            // An error row is listed only while its test has an error.
            return { label: String(node.item.error), collapsible: false, labelColor: "list.errorForeground" };
        }
        const busy = isBusy(node);
        return {
            label: node.item.label,
            icon: busy ? this.spinnerFrame() : this.icons.glyph(UNSET_ICON),
            iconColor: busy ? undefined : "testing.iconUnset",
            collapsible:
                node.children.size > 0 || node.item.error !== null || node.expand !== TestItemExpandState.NotExpandable,
            description: node.item.description ?? undefined,
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

    /** While some test is busy the view has a progress entry: its ticks redraw the row spinners. */
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
            { location: "view", viewId: TESTING_EXPLORER_VIEW_ID, title: "Resolving tests" },
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
        runMenuEntry(
            entry,
            (id) => this.commands.execute(id, arg),
            (message) => {
                this.notifications.show({ severity: "error", message, modal: false, items: [] });
            },
        );
    }
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

/** The order of this task: by `sortText`, else by label; sorting by state and duration comes with runs. */
function compareTests(a: ITestNode, b: ITestNode): number {
    return (a.item.sortText ?? a.item.label).localeCompare(b.item.sortText ?? b.item.label);
}
