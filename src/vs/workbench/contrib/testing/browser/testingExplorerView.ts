import { INHERITED_BG, INHERITED_FG } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { codicon } from "../../../../base/common/codicons.ts";
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
import {
    type IWireTestItemArg,
    TEST_ID_DELIMITER,
    TestId,
    TestItemExpandState,
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
import { treeIndentGuides } from "../../../browser/treeIndentGuides.ts";
import { type IJumpRecorder, JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import { type IRevealLocationTarget, revealLocation } from "../../../services/history/browser/revealLocation.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import {
    FilterResult,
    filterTest,
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
}

/** The error row sorts first and has a key apart from its test's. */
const ERROR_KEY_SUFFIX = `${TEST_ID_DELIMITER}$error`;

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
    private readonly rows = new Map<string, ITestRow>();
    /** For Collapse All: the tree keeps its expansion private. */
    private readonly expanded = new Map<string, ITestRow>();
    /** Rows already shown once: a controller root and a test with an error expand when they first appear. */
    private readonly seen = new Set<string>();
    private filter: ITestExplorerFilter = parseTestExplorerFilter("");
    /** Tests the filter shows (`TreeVisibility.Visible`/`Recurse` with a visible descendant); `null` — no filter. */
    private visible: ReadonlySet<string> | null = null;
    /** What the filter matched itself: upstream `lastIncludedTests`, revealed on a filter change. */
    private included: readonly string[] = [];
    private registered = false;
    /** Tests asked to resolve, until they stop being `Expandable`: upstream's `expandPromises` dedupe. */
    private readonly resolving = new Set<string>();
    private refreshQueued = false;
    private endBusy: (() => void) | null = null;

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
            if (isExpanded) this.expanded.set(rowKey(row), row);
            else this.expanded.delete(rowKey(row));
            if (isExpanded && row.kind === "test") this.resolve(row.testId);
        };
        // Upstream `onDidOpen`: a leaf with a location opens it, the keyboard stays in the tree.
        this.tree.onActivate = (row) => {
            const node = this.tests.getNodeById(row.testId);
            if (row.kind !== "test" || node === undefined || node.children.size > 0) return;
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
            if (event.key !== "ArrowUp" || event.ctrlKey || event.altKey || event.shiftKey) return;
            const first = this.childrenOf(undefined).at(0);
            const selected = this.tree.getSelectedNode();
            if (first === undefined || selected === null || rowKey(selected) !== rowKey(first)) return;
            event.preventDefault();
            this.filterInput.focus();
        });

        this.filterInput.placeholder = "Filter (e.g. text, !exclude, @tag)";
        this.filterInput.onChange = (value) => {
            this.setFilter(value);
        };
        this.filterInput.addEventListener("keydown", (event) => {
            if (event.ctrlKey || event.altKey || event.shiftKey) return;
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
        filterGlyph.setColors(INHERITED_FG, INHERITED_BG);
        const filterRow = new HFlexElement();
        filterRow.addChild(this.filterInput, { width: hflexFill(), height: 1 });
        filterRow.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        filterRow.addChild(filterGlyph, { width: hflexFit(), height: 1 });
        const summary = new TextLabelElement(NO_RESULTS);
        summary.setColors(INHERITED_FG, INHERITED_BG);
        const header = new VStackElement();
        for (const row of [filterRow, summary]) row.layoutStyle = { width: "fill", height: 1 };
        header.replaceChildren([filterRow, summary]);
        const scrollBars = new ScrollBarDecorator(this.tree);
        const root = new HeaderBodyViewElement(new PaddingContainerElement(header, { left: 1, right: 1 }), scrollBars);
        root.id = "testingExplorerView";
        root.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
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
                this.scheduleRefresh();
            }),
        );
        this.register(
            views.onDidChangeViewExpanded(({ viewId, expanded }) => {
                if (viewId === TESTING_EXPLORER_VIEW_ID && expanded) this.resolveRoots();
            }),
        );
        this.register(
            progress.onDidChange(() => {
                if (this.endBusy !== null) this.scheduleRefresh();
            }),
        );
        this.register(
            icons.onDidChange(() => {
                this.scheduleRefresh();
            }),
        );
        this.register(
            menuRegistry.onDidChangeMenu((menuId) => {
                if (menuId === MenuId.TestItem) this.scheduleRefresh();
            }),
        );
        this.register(
            contextKeys.onDidChange((changed) => {
                this.syncRegistration();
                const read = menuRegistry.getMenuContexts(MenuId.TestItem);
                if ([...changed].some((key) => read.has(key))) this.scheduleRefresh();
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

    /** The test of the row under the cursor, `undefined` on an empty tree or an error row's. */
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

    private syncRegistration(): void {
        const shown = this.contextKeys.evaluate(VIEW_WHEN);
        if (shown === this.registered) return;
        this.registered = shown;
        if (!shown) {
            this.views.unregisterView(TESTING_EXPLORER_VIEW_ID);
            return;
        }
        this.views.registerView({
            id: TESTING_EXPLORER_VIEW_ID,
            containerId: TESTING_VIEWLET_ID,
            title: "TEST EXPLORER",
            order: 10,
            body: this.isEmpty() ? null : this.view,
            placeholder: WELCOME,
            canMoveView: true,
            focus: () => {
                this.filterInput.focus();
            },
        });
        // A registration after an unregistration gets the body it had then: `null` would not replace it.
        this.views.setViewBody(TESTING_EXPLORER_VIEW_ID, this.isEmpty() ? null : this.view);
    }

    /** Upstream `testCollectionIsEmpty` while no controller is busy: the welcome. */
    private isEmpty(): boolean {
        return this.tests.rootItems.every((root) => root.children.size === 0 && !isBusy(root));
    }

    private scheduleRefresh(): void {
        if (this.refreshQueued) return;
        this.refreshQueued = true;
        queueMicrotask(() => {
            this.refreshQueued = false;
            void this.refresh();
        });
    }

    private async refresh(): Promise<void> {
        for (const testId of this.resolving) {
            if (this.tests.getNodeById(testId)?.expand !== TestItemExpandState.Expandable)
                this.resolving.delete(testId);
        }
        this.setBusy(this.tests.rootItems.some((root) => this.anyBusy(root)));
        this.updateVisibility();
        // Without a controller there is no view: registering takes the body as it is then.
        if (this.registered) {
            this.views.setViewBody(TESTING_EXPLORER_VIEW_ID, this.isEmpty() ? null : this.view);
            if (this.views.isViewExpanded(TESTING_EXPLORER_VIEW_ID)) this.resolveRoots();
        }
        await this.tree.refresh();
    }

    /** Upstream `storeItem`: a controller's root resolves as soon as the view shows it. */
    private resolveRoots(): void {
        for (const root of this.tests.rootItems) {
            if (root.expand === TestItemExpandState.Expandable) this.resolve(root.item.extId);
        }
    }

    private resolve(testId: string): void {
        if (this.resolving.has(testId)) return;
        if (this.tests.getNodeById(testId)?.expand !== TestItemExpandState.Expandable) return;
        this.resolving.add(testId);
        void this.tests.expandTest(testId, 0);
    }

    private setFilter(text: string): void {
        this.filter = parseTestExplorerFilter(text);
        this.updateVisibility();
        void this.revealIncluded();
    }

    /** Upstream: a filter change expands the tree to every test it matched. */
    private async revealIncluded(): Promise<void> {
        await this.tree.refresh();
        const ancestors = new Set<string>();
        for (const testId of this.included) {
            for (let id = TestId.parentId(testId); id !== undefined; id = TestId.parentId(id)) ancestors.add(id);
        }
        const rows = [...ancestors]
            .filter((id) => this.tests.getNodeById(id) !== undefined)
            .map((id) => this.rowFor(id));
        // Ancestors first: the tree expands a row it already lists.
        await this.tree.expandElements(rows.sort((a, b) => a.testId.length - b.testId.length));
    }

    /** Upstream `TestsFilter` over the whole mirror: what is shown and what matched itself. */
    private updateVisibility(): void {
        const active =
            this.filter.globList.length > 0 || this.filter.includeTags.size > 0 || this.filter.excludeTags.size > 0;
        if (!active) {
            this.visible = null;
            this.included = [];
            return;
        }
        const visible = new Set<string>();
        const included: string[] = [];
        const visit = (node: ITestNode, lineage: ITestNode["item"][]): boolean => {
            const chain = [node.item, ...lineage];
            const result = filterTest(this.filter, chain);
            if (result === FilterResult.Exclude) return false;
            let shown = result === FilterResult.Include || node.item.error !== null;
            for (const childId of node.children) {
                const child = this.tests.getNodeById(childId);
                if (child !== undefined && visit(child, chain)) shown = true;
            }
            if (result === FilterResult.Include) included.push(node.item.extId);
            if (shown) visible.add(node.item.extId);
            return shown;
        };
        for (const root of this.tests.rootItems) visit(root, []);
        this.visible = visible;
        this.included = included;
    }

    /** Upstream `getChildrenForParent`: with one controller that has tests, its tests are the roots. */
    private childrenOf(row: ITestRow | undefined): ITestRow[] {
        let nodes: ITestNode[];
        const result: ITestRow[] = [];
        if (row === undefined) {
            const roots = this.tests.rootItems.filter((root) => root.children.size > 0 || root.item.error !== null);
            if (roots.length !== 1) {
                nodes = roots;
            } else {
                const [root] = roots;
                if (root.item.error !== null) result.push(this.errorRowFor(root.item.extId));
                nodes = this.childNodes(root);
            }
        } else {
            const node = row.kind === "test" ? this.tests.getNodeById(row.testId) : undefined;
            if (node === undefined) return [];
            if (node.item.error !== null) result.push(this.errorRowFor(row.testId));
            nodes = this.childNodes(node);
        }
        const visible = this.visible;
        const shown = visible === null ? nodes : nodes.filter((node) => visible.has(node.item.extId));
        shown.sort(compareTests);
        for (const node of shown) result.push(this.rowFor(node.item.extId));
        this.expandOnFirstSight(row === undefined ? shown : shown.filter((node) => node.item.error !== null));
        return result;
    }

    private childNodes(node: ITestNode): ITestNode[] {
        const nodes: ITestNode[] = [];
        for (const childId of node.children) {
            const child = this.tests.getNodeById(childId);
            if (child !== undefined) nodes.push(child);
        }
        return nodes;
    }

    /** Upstream `PreserveOrExpanded` of a controller root and of a test with an error, once: the user's choice stays. */
    private expandOnFirstSight(nodes: readonly ITestNode[]): void {
        const fresh = nodes.filter((node) => {
            const isFresh = !this.seen.has(node.item.extId);
            this.seen.add(node.item.extId);
            return isFresh && (TestId.parentId(node.item.extId) === undefined || node.item.error !== null);
        });
        if (fresh.length === 0) return;
        // After the tree has taken these children: it expands a row it already lists.
        queueMicrotask(() => {
            void this.tree.expandElements(fresh.map((node) => this.rowFor(node.item.extId)));
        });
    }

    private rowFor(testId: string): ITestRow {
        let row = this.rows.get(testId);
        if (row === undefined) {
            row = { kind: "test", testId };
            this.rows.set(testId, row);
        }
        return row;
    }

    private errorRowFor(testId: string): ITestRow {
        const key = testId + ERROR_KEY_SUFFIX;
        let row = this.rows.get(key);
        if (row === undefined) {
            row = { kind: "error", testId };
            this.rows.set(key, row);
        }
        return row;
    }

    private toTreeItem(row: ITestRow): ITreeItem {
        const node = this.tests.getNodeById(row.testId);
        /* v8 ignore start -- the tree asks only for rows it got from `childrenOf`, after the diff that removed one */
        if (node === undefined) return { label: "", collapsible: false };
        /* v8 ignore stop */
        if (row.kind === "error") {
            return { label: node.item.error ?? "", collapsible: false, labelColor: "list.errorForeground" };
        }
        const busy = isBusy(node);
        return {
            label: node.item.label,
            icon: busy ? this.spinnerFrame() : this.icons.glyph(UNSET_ICON),
            iconColor: busy ? undefined : "testing.iconUnset",
            collapsible:
                node.children.size > 0 || node.item.error !== null || node.expand !== TestItemExpandState.NotExpandable,
            description: node.item.description ?? undefined,
            actions: inlineMenuActions(this.itemMenu(row, true)),
        };
    }

    /** The shared clock of `ProgressService`; before its show delay — the first frame. */
    private spinnerFrame(): string {
        return this.progress.viewProgress().get(TESTING_EXPLORER_VIEW_ID)?.spinner ?? SPINNER_FRAMES[0];
    }

    private anyBusy(node: ITestNode): boolean {
        if (isBusy(node)) return true;
        for (const childId of node.children) {
            const child = this.tests.getNodeById(childId);
            if (child !== undefined && this.anyBusy(child)) return true;
        }
        return false;
    }

    /** While some test is busy the view has a progress entry: its frames drive the row spinners. */
    private setBusy(busy: boolean): void {
        if (busy === (this.endBusy !== null)) return;
        if (!busy) {
            this.endBusy?.();
            this.endBusy = null;
            return;
        }
        void this.progress.withProgress(
            { location: "view", viewId: TESTING_EXPLORER_VIEW_ID, title: "Resolving tests" },
            () =>
                new Promise<void>((resolve) => {
                    this.endBusy = resolve;
                }),
        );
    }

    /** Upstream `getActionableElementActions`: the row's keys on top of the global ones. */
    private itemMenu(row: ITestRow, inline: boolean): IMenuEntryGroup[] {
        if (row.kind === "error") return [];
        const node = this.tests.getNodeById(row.testId);
        const keys: MenuContextKeys = {
            view: TESTING_EXPLORER_VIEW_ID,
            testId: row.testId.slice(row.testId.lastIndexOf(TEST_ID_DELIMITER) + 1),
            controllerId: node?.controllerId ?? "",
            "testing.testItemHasUri": node?.item.uri !== undefined,
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
    private runEntry(entry: Parameters<typeof runMenuEntry>[0], row: ITestRow): void {
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

function rowKey(row: ITestRow): string {
    return row.kind === "error" ? row.testId + ERROR_KEY_SUFFIX : row.testId;
}

function isBusy(node: ITestNode): boolean {
    return node.item.busy || node.expand === TestItemExpandState.BusyExpanding;
}

/** The order of this task: by `sortText`, else by label; sorting by state and duration comes with runs. */
function compareTests(a: ITestNode, b: ITestNode): number {
    return (a.item.sortText ?? a.item.label).localeCompare(b.item.sortText ?? b.item.label);
}
