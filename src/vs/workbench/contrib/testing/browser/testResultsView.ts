import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import type { ITreeDataProvider, ITreeItem, ITreeItemAction } from "@tuidom/elements/tree/iTreeDataProvider";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { codicon, type IProductIcon } from "../../../../base/common/codicons.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable, DisposableMap, DisposableStore, MutableDisposable } from "../../../../base/common/lifecycle.ts";
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
import { type IWireTestItemArg, TestId, TestResultState } from "../../../api/common/testingWireTypes.ts";
import { type ViewsService, ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { onDidChangeTreeIndentGuides, treeIndentGuides } from "../../../browser/treeIndentGuides.ts";
import {
    type TerminalColorsService,
    TerminalColorsServiceDIToken,
} from "../../terminal/browser/terminalColorsService.ts";
import {
    type ExtensionPtySessionFactory,
    ExtensionPtySessionFactoryDIToken,
} from "../../terminal/common/terminalSessionFactory.ts";
import { dominantState, isFailedState, statePriority } from "../common/testingStates.ts";
import type { ITestResultItem, LiveTestResult } from "../common/testResult.ts";
import { type TestResultService, TestResultServiceDIToken } from "../common/testResultService.ts";

import { TESTING_EXPLORER_VIEW_ID } from "./testingExplorerView.ts";
import { CANCEL_ICON, RERUN_ICON, RUN_ICON, STATE_ICONS } from "./testingIcons.ts";
import { TestResultsOutput, type TestResultsSubject } from "./testResultsOutput.ts";
import { TestResultsSplitElement } from "./testResultsSplitElement.ts";

/** Upstream `Testing.ResultsPanelId`. */
export const TEST_RESULTS_CONTAINER_ID = "workbench.panel.testResults";
/** Upstream `Testing.ResultsViewId`. */
export const TEST_RESULTS_VIEW_ID = "workbench.panel.testResults.view";

export const TestResultsComponentDIToken = token<TestResultsComponent>("TestResultsComponent");

/** A run's changes of this long come to the tree in one refresh. */
const REFRESH_DELAY = 16;

const TERMINAL_ICON = codicon("terminal");
const GO_TO_FILE_ICON = codicon("go-to-file");
const LIST_TREE_ICON = codicon("list-tree");

/** A row of the results tree (upstream's `TreeElement`s without coverage). */
export type TestResultsRow =
    | { readonly kind: "older"; readonly count: number }
    | { readonly kind: "result"; readonly result: LiveTestResult }
    | TestResultsSubject;

/** Upstream `TreeActionsProvider`'s action: a glyph on the row and an entry of its menu. */
interface IRowAction {
    readonly label: string;
    readonly icon: IProductIcon;
    /** Only in the context menu (upstream's `secondary`). */
    readonly secondary?: boolean;
    run(): unknown;
}

/**
 * Upstream `TestResultsView` (`testingOutputPeek.ts`) with `TestResultsViewContent` and `OutputPeekTree`: a panel
 * tab while there is any result, the output of the chosen run, test or message on the left, the runs' tree on the
 * right. Also upstream's `TestingProgressUiService`: a run that starts opens the panel per
 * `testing.automaticallyOpenTestResults`.
 */
export class TestResultsComponent extends Disposable {
    public static dependencies = [
        TestResultServiceDIToken,
        ViewsServiceDIToken,
        ContextKeyServiceDIToken,
        ProductIconServiceDIToken,
        ProgressServiceDIToken,
        ContextMenuServiceDIToken,
        CommandRegistryDIToken,
        IConfigurationServiceDIToken,
        ExtensionPtySessionFactoryDIToken,
        TerminalColorsServiceDIToken,
    ] as const;

    public readonly tree: TreeViewElement<TestResultsRow>;
    public readonly view: TestResultsSplitElement;
    private readonly output: TestResultsOutput;
    private readonly refreshLater: RunOnceScheduler;
    private subject: TestResultsSubject | null = null;
    /** Rows already shown once: a task and a test expand when they first appear. */
    private readonly seen = new Set<string>();
    private readonly liveStores = this.register(new DisposableMap<LiveTestResult, DisposableStore>());
    private readonly spinnerTicks = this.register(new MutableDisposable());

    public constructor(
        private readonly results: TestResultService,
        private readonly views: ViewsService,
        private readonly contextKeys: ContextKeyService,
        private readonly icons: IProductIconService,
        private readonly progress: ProgressService,
        private readonly contextMenu: ContextMenuService,
        private readonly commands: CommandRegistry,
        private readonly configuration: IConfigurationService,
        createSession: ExtensionPtySessionFactory,
        colors: TerminalColorsService,
    ) {
        super();
        const provider: ITreeDataProvider<TestResultsRow> = {
            getTreeItem: (row) => this.toTreeItem(row),
            getChildren: (row) => this.childrenOf(row),
            getKey: (row) => rowKey(row),
        };
        this.tree = new TreeViewElement(provider, {
            leftPadding: 1,
            inlineActionsRightPadding: 1,
            expandOnlyOnTwistieClick: () => configuration.get("workbench.tree.expandMode") === "doubleClick",
            openOnSingleClick: () => configuration.get("workbench.list.openMode") !== "doubleClick",
            renderIndentGuides: treeIndentGuides(configuration),
        });
        this.tree.id = "testResultsTree";
        this.tree.onSelect = (row) => {
            const subject = subjectOf(row);
            if (subject !== null) this.show(subject);
        };
        // Upstream `onDidOpen` of a test reveals its message; here Enter goes to the test (the spec's decision). A
        // click only chooses the row: its preview opening is the content on the left.
        this.tree.onActivate = (row, options) => {
            if (row.kind === "test" && options.pinned) this.execute("testing.editFocusedTest", testArg(row));
        };
        this.tree.onInlineAction = (row, index) => {
            primaryActions(this.actionsOf(row))[index].run();
        };
        this.tree.onContextMenu = (row, screenX, screenY) => {
            this.showContextMenu(row, screenX, screenY);
        };
        this.output = this.register(new TestResultsOutput(createSession, colors));
        this.view = new TestResultsSplitElement(
            this.output.widget,
            new ScrollBarDecorator(this.tree),
            this.isTreeLeft(),
        );
        this.view.id = "testResultsView";

        views.registerContainer({
            id: TEST_RESULTS_CONTAINER_ID,
            title: "TEST RESULTS",
            label: "Test Results",
            location: "panel",
            // Upstream `order: 3`: after Terminal.
            order: 3,
        });
        this.refreshLater = this.register(
            new RunOnceScheduler(() => {
                void this.tree.refresh().catch(onUnexpectedError);
            }, REFRESH_DELAY),
        );
        this.register(
            results.onResultsChanged((event) => {
                this.syncRegistration();
                if ("started" in event) {
                    const store = new DisposableStore();
                    // Stryker disable next-line CallExpression: hygiene — a run that is not kept here only keeps its own listeners; it fires nothing once removed
                    this.liveStores.set(event.started, store);
                    this.attachToLive(event.started, store);
                    this.autoOpen(event.started, store);
                }
                if ("removed" in event) for (const removed of event.removed) this.forget(removed);
                this.syncSpinner();
                this.refresh();
            }),
        );
        this.register(
            results.onTestChanged(() => {
                this.refresh();
            }),
        );
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                // Stryker disable next-line ConditionalExpression: equivalent — another setting's change puts the tree on the same side again
                if (event.affectsConfiguration("testing.resultsView.layout")) this.view.setTreeLeft(this.isTreeLeft());
            }),
        );
        this.register(
            icons.onDidChange(() => {
                this.refresh();
            }),
        );
        this.register(
            onDidChangeTreeIndentGuides(configuration, () => {
                this.tree.markDirty();
            }),
        );
        this.syncRegistration();
    }

    /** What the content shows, `null` before anything was chosen. */
    public get currentSubject(): TestResultsSubject | null {
        return this.subject;
    }

    /** Upstream `showLatestRun`: the first task of the latest run that has one, its row under the cursor. */
    public showLatestRun(): void {
        const result = this.latestWithTasks();
        if (result !== undefined) this.reveal({ kind: "task", result, taskIndex: 0 });
    }

    /** Upstream `ToggleResultsViewLayoutAction`. */
    public async toggleLayout(): Promise<void> {
        await this.configuration.updateValue(
            "testing.resultsView.layout",
            this.isTreeLeft() ? "treeRight" : "treeLeft",
        );
    }

    /** Upstream's root run: the latest one that has a task. */
    private latestWithTasks(): LiveTestResult | undefined {
        return this.results.results.find((result) => result.tasks.length > 0);
    }

    private isTreeLeft(): boolean {
        return this.configuration.get("testing.resultsView.layout") === "treeLeft";
    }

    /** Upstream `hideIfEmpty`: the view, and with it the tab, is there while there is any result. */
    private syncRegistration(): void {
        const shown = this.results.results.length > 0;
        const registered = this.views.getViewContainerByViewId(TEST_RESULTS_VIEW_ID) !== null;
        // Stryker disable next-line ConditionalExpression: equivalent — registering the registered view again replaces its record with the same one, unregistering a missing one does nothing; the guard saves the work
        if (shown === registered) return;
        if (!shown) {
            this.views.unregisterView(TEST_RESULTS_VIEW_ID);
            return;
        }
        this.views.registerView({
            id: TEST_RESULTS_VIEW_ID,
            containerId: TEST_RESULTS_CONTAINER_ID,
            title: "TEST RESULTS",
            order: 10,
            body: this.view,
            canMoveView: true,
            canToggleVisibility: false,
            focus: () => {
                this.tree.focus();
            },
        });
    }

    /**
     * Upstream `attachAutoOpenForNewResults`: not for a run that asked to preserve the focus; the view opens without
     * taking the keyboard.
     */
    private autoOpen(result: LiveTestResult, store: DisposableStore): void {
        if (result.request.preserveFocus === true) return;
        switch (this.configuration.get("testing.automaticallyOpenTestResults")) {
            case "openOnTestStart":
                this.views.openView(TEST_RESULTS_VIEW_ID, false);
                return;
            case "openExplorerOnTestStart":
                this.views.openView(TESTING_EXPLORER_VIEW_ID, false);
                return;
            case "openOnTestFailure": {
                // A test's own state turns failed only by an "ownState" change: the first failed one is that change.
                const listener = result.onChange((change) => {
                    if (!isFailedState(change.item.ownComputedState)) return;
                    this.views.openView(TEST_RESULTS_VIEW_ID, false);
                    listener.dispose();
                });
                // Stryker disable next-line CallExpression: hygiene — a removed run fires nothing more; only the listener's memory goes
                store.add(listener);
                return;
            }
            default:
        }
    }

    /** A removed run: its listeners, its rows' memory and, if shown, the content go. */
    private forget(result: LiveTestResult): void {
        // Stryker disable next-line CallExpression: hygiene — a removed run fires nothing more; only its listeners' memory goes
        this.liveStores.deleteAndDispose(result);
        // Stryker disable next-line ConditionalExpression,MethodExpression,CallExpression: hygiene — a removed run's keys are never asked again; only their memory goes
        for (const key of this.seen) if (key.startsWith(`${result.id}/`)) this.seen.delete(key);
        if (this.subject?.result === result) {
            this.subject = null;
            this.output.clear();
        }
    }

    /** Upstream `attachToResults`: a new task redraws the tree; the first task of a new run is shown. */
    private attachToLive(result: LiveTestResult, store: DisposableStore): void {
        store.add(
            result.onNewTask((index) => {
                if (index === 0 && this.results.results[0] === result)
                    this.reveal({ kind: "task", result, taskIndex: 0 });
                else this.refresh();
            }),
        );
        store.add(
            result.onEndTask(() => {
                this.refresh();
            }),
        );
    }

    /** While a run goes on its spinners tick with the Test Explorer's; a hidden panel is not redrawn. */
    private syncSpinner(): void {
        if (!this.results.isRunning) {
            this.spinnerTicks.clear();
            return;
        }
        this.spinnerTicks.value ??= this.progress.onDidChange(() => {
            if (this.views.isViewShown(TEST_RESULTS_VIEW_ID)) this.refresh();
        });
    }

    private spinnerFrame(): string {
        return this.progress.viewProgress().get(TESTING_EXPLORER_VIEW_ID)?.spinner ?? SPINNER_FRAMES[0];
    }

    /** The changes of a frame come to the tree in one refresh. */
    private refresh(): void {
        if (!this.refreshLater.isScheduled()) this.refreshLater.schedule();
    }

    private show(subject: TestResultsSubject): void {
        // Stryker disable next-line ConditionalExpression: equivalent — the same subject again resets the surface and writes the same output, the scroll stays; the guard saves the work
        if (this.subject !== null && rowKey(this.subject) === rowKey(subject)) return;
        this.subject = subject;
        this.output.show(subject);
    }

    /** Upstream `onDidReveal`: the row's ancestors expand and the cursor goes to it; the content follows. */
    private reveal(subject: TestResultsSubject): void {
        this.show(subject);
        const chain: TestResultsRow[] = [];
        if (this.latestWithTasks() !== subject.result) {
            // The "older" row's key does not depend on its count.
            chain.push({ kind: "older", count: 0 }, { kind: "result", result: subject.result });
        }
        chain.push({ kind: "task", result: subject.result, taskIndex: subject.taskIndex });
        if (subject.kind !== "task") chain.push({ ...subject, kind: "test" });
        void this.tree
            .refresh()
            .then(() => this.tree.reveal(chain))
            .catch(onUnexpectedError);
    }

    /**
     * Upstream `getRootChildren`: the tasks of the latest run that has any, the others under "N older results"; with
     * no run with tasks every run is a root.
     */
    private childrenOf(row: TestResultsRow | undefined): TestResultsRow[] {
        let children: TestResultsRow[];
        if (row === undefined) {
            const latest = this.latestWithTasks();
            const older = this.olderResults(latest);
            if (latest === undefined) return older;
            children = tasksOf(latest);
            if (older.length > 0) children.push({ kind: "older", count: older.length });
        } else if (row.kind === "older") {
            return this.olderResults(this.latestWithTasks());
        } else if (row.kind === "result") {
            children = tasksOf(row.result);
        } else if (row.kind === "task") {
            children = this.testsOf(row.result, row.taskIndex);
            // Stryker disable next-line ConditionalExpression: equivalent — a message row is not collapsible, the tree never asks for its children
        } else if (row.kind === "test") {
            children = errorMessagesOf(row);
        } else {
            // Stryker disable next-line ArrayDeclaration: equivalent — see above
            return [];
        }
        this.expandOnFirstSight(children);
        return children;
    }

    private olderResults(latest: LiveTestResult | undefined): TestResultsRow[] {
        return this.results.results
            .filter((result) => result !== latest)
            .map((result): TestResultsRow => ({ kind: "result", result }));
    }

    /** Upstream `getTaskChildren`: the tests that ran or have messages, the highest priority of their state first. */
    private testsOf(result: LiveTestResult, taskIndex: number): TestResultsRow[] {
        return [...result.tests]
            .filter((test) => {
                const task = test.tasks[taskIndex];
                return task.state >= TestResultState.Running || task.messages.length > 0;
            })
            .sort((a, b) => statePriority[b.tasks[taskIndex].state] - statePriority[a.tasks[taskIndex].state])
            .map((test) => ({ kind: "test", result, taskIndex, test }));
    }

    /** Upstream's tasks and tests are expanded unless the user collapsed them; the older runs stay collapsed. */
    private expandOnFirstSight(rows: readonly TestResultsRow[]): void {
        const fresh = rows.filter((row) => {
            const key = rowKey(row);
            const isFresh = !this.seen.has(key);
            this.seen.add(key);
            return isFresh && (row.kind === "task" || row.kind === "test");
        });
        // After the tree has taken these children: it expands a row it already lists.
        queueMicrotask(() => {
            void this.tree.expandElements(fresh);
        });
    }

    private toTreeItem(row: TestResultsRow): ITreeItem {
        switch (row.kind) {
            case "older":
                return {
                    label: row.count === 1 ? "1 older result" : `${String(row.count)} older results`,
                    collapsible: true,
                };
            case "result": {
                const { result } = row;
                const state = result.completedAt === undefined ? TestResultState.Running : dominantState(result.counts);
                return { label: result.name, ...this.stateIcon(state), collapsible: true, actions: this.inlineOf(row) };
            }
            case "task": {
                const task = row.result.tasks[row.taskIndex];
                return {
                    label: task.name,
                    ...(task.running ? this.stateIcon(TestResultState.Running) : {}),
                    collapsible: true,
                    actions: this.inlineOf(row),
                };
            }
            case "test": {
                const { test } = row;
                return {
                    label: test.item.label,
                    description: this.parentLabels(row.result, test),
                    ...this.stateIcon(test.tasks[row.taskIndex].state),
                    collapsible: test.tasks[row.taskIndex].messages.some((message) => message.type === "error"),
                    actions: this.inlineOf(row),
                };
            }
            case "message": {
                const text = row.test.tasks[row.taskIndex].messages[row.messageIndex].message;
                const lines = text.trimEnd().split("\n").length - 1;
                return {
                    label: text.split("\n")[0],
                    description:
                        lines === 0 ? undefined : lines === 1 ? "+ 1 more line" : `+ ${String(lines)} more lines`,
                    collapsible: false,
                    actions: this.inlineOf(row),
                };
            }
        }
    }

    private stateIcon(state: TestResultState): Pick<ITreeItem, "icon" | "iconColor"> {
        if (state === TestResultState.Running) return { icon: this.spinnerFrame() };
        // Every state but Running has an icon.
        const icon = assertReturnsDefined(STATE_ICONS[state]);
        return { icon: this.icons.glyph(icon.icon), iconColor: icon.color };
    }

    /** Upstream `TestCaseElement.description`: the parents' labels up to the controller's root, joined by " ‹ ". */
    private parentLabels(result: LiveTestResult, test: ITestResultItem): string | undefined {
        const labels: string[] = [];
        for (let id = TestId.parentId(test.item.extId); id !== undefined; id = TestId.parentId(id)) {
            if (TestId.parentId(id) === undefined) break;
            // The run holds the whole chain of its tests (`addTestChainToRun`).
            labels.push(assertReturnsDefined(result.getStateById(id)).item.label);
        }
        return labels.join(" ‹ ") || undefined;
    }

    private inlineOf(row: TestResultsRow): ITreeItemAction[] {
        return primaryActions(this.actionsOf(row)).map((action) => ({
            label: action.label,
            icon: this.icons.glyph(action.icon),
        }));
    }

    private commandAction(label: string, icon: IProductIcon, commandId: string, ...args: unknown[]): IRowAction {
        return {
            label,
            icon,
            run: () => {
                this.execute(commandId, ...args);
            },
        };
    }

    /** Upstream `TreeActionsProvider.provideActionBar` without the debug entries and coverage. */
    private actionsOf(row: TestResultsRow): IRowAction[] {
        if (row.kind === "older") return [];
        const { result } = row;
        const rerunFailed = (): IRowAction[] =>
            [...result.tests].some((test) => isFailedState(test.ownComputedState))
                ? [this.commandAction("Rerun Failed Tests", RERUN_ICON, "testing.reRunFailedFromLastRun", result.id)]
                : [];
        if (row.kind === "task") {
            const task = result.tasks[row.taskIndex];
            return [
                this.showOutputAction(row),
                ...(task.running
                    ? [this.commandAction("Cancel Test Run", CANCEL_ICON, "testing.cancelRun", result.id, task.id)]
                    : [
                          this.commandAction("Rerun Last Run", RERUN_ICON, "testing.reRunLastRun", result.id),
                          ...rerunFailed(),
                      ]),
            ];
        }
        if (row.kind === "result") {
            return [
                ...(result.tasks.length === 1 ? [this.showOutputAction({ kind: "task", result, taskIndex: 0 })] : []),
                this.commandAction("Rerun Test", RUN_ICON, "testing.reRunLastRun", result.id),
                ...rerunFailed(),
            ];
        }
        const { test } = row;
        const arg = testArg(row);
        const actions: IRowAction[] = [];
        if (test.item.uri !== undefined)
            actions.push(this.commandAction("Go to Test", GO_TO_FILE_ICON, "testing.editFocusedTest", arg));
        if (test.tasks[row.taskIndex].messages.some((message) => message.type === "output"))
            actions.push(this.showOutputAction({ ...row, kind: "test" }));
        actions.push({
            ...this.commandAction("Reveal in Test Explorer", LIST_TREE_ICON, "_revealTestInExplorer", test.item.extId),
            secondary: true,
        });
        if (this.contextKeys.get("testing.hasRunnableTests") === true)
            actions.push(this.commandAction("Run Test", RUN_ICON, "testing.run", arg));
        return actions;
    }

    private showOutputAction(subject: TestResultsSubject): IRowAction {
        return {
            label: "Show Result Output",
            icon: TERMINAL_ICON,
            run: () => {
                this.reveal(subject);
            },
        };
    }

    /** Upstream: the inline actions, then the secondary ones after a separator. */
    private showContextMenu(row: TestResultsRow, screenX: number, screenY: number): void {
        const actions = this.actionsOf(row);
        const toEntry = (action: IRowAction): MenuEntry => ({ label: action.label, onSelect: () => action.run() });
        const primary = primaryActions(actions).map(toEntry);
        const secondary = actions.filter((action) => action.secondary === true).map(toEntry);
        const separator: MenuEntry[] = primary.length > 0 && secondary.length > 0 ? [{ type: "separator" }] : [];
        const entries = [...primary, ...separator, ...secondary];
        if (entries.length === 0) return;
        this.contextMenu.showContextMenu({
            getOwner: () => this.tree,
            getAnchor: () => ({ screenX, screenY }),
            getEntries: () => entries,
        });
    }

    private execute(commandId: string, ...args: unknown[]): void {
        void Promise.resolve(this.commands.execute(commandId, ...args)).catch(onUnexpectedError);
    }
}

/** The glyphs of the row (upstream's `primary`), in the order the row draws them. */
function primaryActions(actions: readonly IRowAction[]): IRowAction[] {
    return actions.filter((action) => action.secondary !== true);
}

function tasksOf(result: LiveTestResult): TestResultsRow[] {
    return result.tasks.map((_, taskIndex) => ({ kind: "task", result, taskIndex }));
}

/** Upstream `getTestChildren`: the error messages; the output ones are the test's output. */
function errorMessagesOf(row: {
    readonly result: LiveTestResult;
    readonly taskIndex: number;
    readonly test: ITestResultItem;
}) {
    const messages = row.test.tasks[row.taskIndex].messages;
    const rows: TestResultsRow[] = [];
    messages.forEach((message, messageIndex) => {
        if (message.type === "error") rows.push({ ...row, kind: "message", messageIndex });
    });
    return rows;
}

/** What the content shows for a row: an older run shows its first task. */
function subjectOf(row: TestResultsRow): TestResultsSubject | null {
    if (row.kind === "older") return null;
    if (row.kind === "result")
        return row.result.tasks.length > 0 ? { kind: "task", result: row.result, taskIndex: 0 } : null;
    return row;
}

function testArg(row: { readonly test: ITestResultItem }): IWireTestItemArg {
    return { $testId: row.test.item.extId };
}

function rowKey(row: TestResultsRow): string {
    switch (row.kind) {
        case "older":
            // Stryker disable next-line StringLiteral: equivalent — any constant key is unique among the rows
            return "older";
        // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent — a run falls to the task key "<id>/undefined", as unique
        case "result":
            return `result:${row.result.id}`;
        case "task":
            return `${row.result.id}/${String(row.taskIndex)}`;
        // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent — a test falls to the message key "<…>/undefined", as unique
        case "test":
            return `${row.result.id}/${String(row.taskIndex)}/${row.test.item.extId}`;
        case "message":
            return `${row.result.id}/${String(row.taskIndex)}/${row.test.item.extId}/${String(row.messageIndex)}`;
    }
}
