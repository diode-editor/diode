import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import {
    type IWireTestItemArg,
    TestItemExpandState,
    TestRunProfileBitset,
    type TestRunProfileGroup,
} from "../../../api/common/testingWireTypes.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { openExtensionsSearch } from "../../extensions/browser/extensionsSearch.ts";
import { isFailedState } from "../common/testingStates.ts";
import {
    CAPABILITY_CONTEXT_KEY,
    type OfferedTestRunGroup,
    TestProfileServiceDIToken,
} from "../common/testProfileService.ts";
import type { LiveTestResult } from "../common/testResult.ts";
import { TestResultServiceDIToken } from "../common/testResultService.ts";
import { type ITestNode, TestServiceDIToken } from "../common/testService.ts";

import { testingDebugAllIcon, testingDebugIcon } from "./icons.ts";
import {
    type TestExplorerViewSorting,
    TESTING_EXPLORER_VIEW_ID,
    TESTING_VIEWLET_ID,
    TestingExplorerComponentDIToken,
} from "./testingExplorerView.ts";
import { TEST_RESULTS_VIEW_ID, TestResultsComponentDIToken } from "./testResultsView.ts";

const CAN_REFRESH = "testing.canRefresh";
const IS_RUNNING = "testing.isRunning";
const HAS_RESULTS = "testing.hasAnyResults";
const PEEK_HAS_STACK = "testing.peekHasStack";

/** Upstream `ActionOrder`: positions in the title's navigation and in the row's menus. */
const ActionOrder = {
    Refresh: 10,
    Run: 11,
    Debug: 12,
    Collapse: 16,
    ClearResults: 17,
    DisplayMode: 18,
    Sort: 19,
    GoToTest: 20,
} as const;

/** What a Run or Debug action of the view takes from its group: the key, its place and its glyphs. */
const GROUP_UI = {
    [TestRunProfileBitset.Run]: {
        capability: CAPABILITY_CONTEXT_KEY[TestRunProfileBitset.Run],
        order: ActionOrder.Run,
        icon: codicon("run"),
        allIcon: codicon("run-all"),
    },
    [TestRunProfileBitset.Debug]: {
        capability: CAPABILITY_CONTEXT_KEY[TestRunProfileBitset.Debug],
        order: ActionOrder.Debug,
        icon: testingDebugIcon,
        allIcon: testingDebugAllIcon,
    },
} as const;

/** Upstream `testItemInlineAndInContext`: the row's glyph and its context menu entry. */
function testItemInlineAndInContext(order: number, icon: ReturnType<typeof codicon>, when?: string) {
    return [
        { menuId: MenuId.TestItem, group: "inline", order, icon, when },
        { menuId: MenuId.TestItem, group: "builtin@1", order, when },
    ] as const;
}

/** The row's test from its menu (`{ $testId }`), the focused one from a key. */
function argTestId(accessor: ServiceAccessor, arg: unknown): string | undefined {
    const testId = (arg as Partial<IWireTestItemArg> | undefined)?.$testId;
    return typeof testId === "string" ? testId : accessor.get(TestingExplorerComponentDIToken).focusedTestId;
}

/** Upstream `discoverAndRunTests` without the discovery: the ids the mirror knows run with the group's defaults. */
async function runTestIds(
    accessor: ServiceAccessor,
    testIds: Iterable<string>,
    group: TestRunProfileGroup,
): Promise<void> {
    const tests = accessor.get(TestServiceDIToken);
    const nodes = [...testIds].flatMap((testId) => tests.getNodeById(testId) ?? []);
    if (nodes.length > 0) await tests.runTests({ tests: nodes, group });
}

/** Upstream `getTreeIncludeExclude`: the visible tests (within the given ones) with the group's defaults. */
async function runVisible(
    accessor: ServiceAccessor,
    group: TestRunProfileGroup,
    within?: readonly ITestNode[],
): Promise<void> {
    const { include, exclude } = accessor.get(TestingExplorerComponentDIToken).getTreeIncludeExclude(within);
    await accessor.get(TestServiceDIToken).runTests({ tests: include, exclude, group });
}

/** The latest run, or the one `runId` names. */
function lastRun(accessor: ServiceAccessor, runId: unknown): LiveTestResult | undefined {
    const results = accessor.get(TestResultServiceDIToken);
    return typeof runId === "string" ? results.getResult(runId) : results.results.at(0);
}

/** Upstream `openCommandActionDescriptor` of the container: the View menu's "Testing", no key. */
export const showTestingAction: CommandAction = {
    id: TESTING_VIEWLET_ID,
    title: "View: Show Testing",
    shortTitle: "Testing",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 19 }],
    run(accessor) {
        accessor.get(ViewsServiceDIToken).openViewContainer(TESTING_VIEWLET_ID, true);
    },
};

/** Upstream `RefreshTestsAction`: every controller's `refreshHandler`; without one the command is unavailable. */
export const refreshTestsAction: CommandAction = {
    id: "testing.refreshTests",
    title: "Test: Refresh Tests",
    shortTitle: "Refresh Tests",
    keybinding: { keys: parseChord("mod+; mod+r"), when: CAN_REFRESH },
    enablement: CAN_REFRESH,
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: ActionOrder.Refresh,
            icon: codicon("refresh"),
            visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
            when: `${CAN_REFRESH} && !testing.isRefreshing`,
        },
    ],
    async run(accessor) {
        await accessor.get(TestServiceDIToken).refreshTests();
    },
};

/** Upstream `CancelTestRefreshAction`: cancels the tokens of the refreshes in flight; in Refresh's place meanwhile. */
export const cancelTestRefreshAction: CommandAction = {
    id: "testing.cancelTestRefresh",
    title: "Test: Cancel Test Refresh",
    shortTitle: "Cancel Test Refresh",
    enablement: CAN_REFRESH,
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: ActionOrder.Refresh,
            icon: codicon("stop"),
            visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
            when: `${CAN_REFRESH} && testing.isRefreshing`,
        },
    ],
    run(accessor) {
        accessor.get(TestServiceDIToken).cancelRefreshTests();
    },
};

/**
 * Upstream `ExecuteSelectedAction`: the tests the view shows — without a filter all of them, with one those it
 * matched — with the group's defaults. In the title while nothing runs; Cancel Test Run takes Run's slot meanwhile.
 */
function executeSelectedAction(group: OfferedTestRunGroup, id: string, label: string): CommandAction {
    const { capability, order, allIcon } = GROUP_UI[group];
    return {
        id,
        title: `Test: ${label}`,
        shortTitle: label,
        enablement: capability,
        menus: [
            {
                menuId: MenuId.ViewTitle,
                group: "navigation",
                order,
                icon: allIcon,
                visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
                when: `!${IS_RUNNING} && ${capability}`,
            },
        ],
        run(accessor) {
            return runVisible(accessor, group);
        },
    };
}

/** Upstream `RunSelectedAction`. */
export const runSelectedTestsAction = executeSelectedAction(
    TestRunProfileBitset.Run,
    "testing.runSelected",
    "Run Tests",
);

/** Upstream `DebugSelectedAction`. */
export const debugSelectedTestsAction = executeSelectedAction(
    TestRunProfileBitset.Debug,
    "testing.debugSelected",
    "Debug Tests",
);

/** Upstream `CancelTestRunAction`: the given run (and task), otherwise every live run. */
export const cancelTestRunAction: CommandAction = {
    id: "testing.cancelRun",
    title: "Test: Cancel Test Run",
    shortTitle: "Cancel Test Run",
    keybinding: parseChord("mod+; mod+x"),
    enablement: IS_RUNNING,
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: ActionOrder.Run,
            icon: codicon("debug-stop"),
            visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
            when: IS_RUNNING,
        },
    ],
    run(accessor, resultId?: unknown, taskId?: unknown) {
        accessor
            .get(TestServiceDIToken)
            .cancelTestRun(
                typeof resultId === "string" ? resultId : undefined,
                typeof taskId === "string" ? taskId : undefined,
            );
    },
};

/** Upstream `RunVisibleAction`: the row's test with its visible descendants; inline and in the row's menu. */
function runVisibleAction(group: OfferedTestRunGroup, id: string, label: string): CommandAction {
    const { capability, order, icon } = GROUP_UI[group];
    return {
        id,
        title: `Test: ${label}`,
        shortTitle: label,
        enablement: capability,
        menus: testItemInlineAndInContext(order, icon, capability),
        async run(accessor, arg) {
            const testId = argTestId(accessor, arg);
            // Stryker disable next-line ConditionalExpression: equivalent — the mirror has no test under an undefined id either
            const node = testId === undefined ? undefined : accessor.get(TestServiceDIToken).getNodeById(testId);
            if (node !== undefined) await runVisible(accessor, group, [node]);
        },
    };
}

/** Upstream `RunAction`. */
export const runTestAction = runVisibleAction(TestRunProfileBitset.Run, "testing.run", "Run Test");

/** Upstream `DebugAction`. */
export const debugTestAction = runVisibleAction(TestRunProfileBitset.Debug, "testing.debug", "Debug Test");

/** Upstream `RunOrDebugAllTestsAction`: every controller that has or may have tests. */
function allTestsAction(
    group: OfferedTestRunGroup,
    id: string,
    label: string,
    key: string,
    noTestsFound: string,
): CommandAction {
    return {
        id,
        title: `Test: ${label}`,
        shortTitle: label,
        keybinding: parseChord(key),
        menus: [{ menuId: MenuId.CommandPalette, when: GROUP_UI[group].capability }],
        async run(accessor) {
            const tests = accessor.get(TestServiceDIToken);
            const roots = tests.rootItems.filter(
                (root: ITestNode) =>
                    root.children.size > 0 ||
                    root.expand === TestItemExpandState.Expandable ||
                    root.expand === TestItemExpandState.BusyExpanding,
            );
            if (roots.length === 0) {
                accessor.get(NotificationServiceDIToken).show({
                    severity: "info",
                    message: noTestsFound,
                    modal: false,
                    items: [],
                });
                return;
            }
            await tests.runTests({ tests: roots, group });
        },
    };
}

/** Upstream `RunAllAction`. */
export const runAllTestsAction = allTestsAction(
    TestRunProfileBitset.Run,
    "testing.runAll",
    "Run All Tests",
    "mod+; a",
    "No tests found in this workspace. You may need to install a test provider extension",
);

/** Upstream `DebugAllAction`. */
export const debugAllTestsAction = allTestsAction(
    TestRunProfileBitset.Debug,
    "testing.debugAll",
    "Debug All Tests",
    "mod+; mod+a",
    "No debuggable tests found in this workspace. You may need to install a test provider extension",
);

/** Upstream `RunOrDebugFailedTests`: the tests whose latest result over all runs failed. */
function failedTestsAction(group: TestRunProfileGroup, id: string, label: string, key: string): CommandAction {
    return {
        id,
        title: `Test: ${label}`,
        shortTitle: label,
        keybinding: parseChord(key),
        enablement: HAS_RESULTS,
        async run(accessor) {
            const { results } = accessor.get(TestResultServiceDIToken);
            const failed = new Set<string>();
            for (const result of [...results].reverse()) {
                for (const test of result.tests) {
                    if (isFailedState(test.ownComputedState)) failed.add(test.item.extId);
                    else failed.delete(test.item.extId);
                }
            }
            await runTestIds(accessor, failed, group);
        },
    };
}

/** Upstream `ReRunFailedTests`. */
export const reRunFailedTestsAction = failedTestsAction(
    TestRunProfileBitset.Run,
    "testing.reRunFailTests",
    "Rerun Failed Tests",
    "mod+; e",
);

/** Upstream `DebugFailedTests`. */
export const debugFailedTestsAction = failedTestsAction(
    TestRunProfileBitset.Debug,
    "testing.debugFailTests",
    "Debug Failed Tests",
    "mod+; mod+e",
);

/**
 * Upstream `RunOrDebugLastRun`: a run of the same group again with the same targets and profiles while they exist,
 * otherwise its tests with the group's defaults.
 */
function lastRunAction(group: TestRunProfileGroup, id: string, label: string, key: string): CommandAction {
    return {
        id,
        title: `Test: ${label}`,
        shortTitle: label,
        keybinding: parseChord(key),
        enablement: HAS_RESULTS,
        async run(accessor, runId) {
            const last = lastRun(accessor, runId);
            if (last === undefined) return;
            const { request } = last;
            const profiles = accessor.get(TestProfileServiceDIToken);
            const profilesExist = request.targets.every((target) =>
                profiles.getControllerProfiles(target.controllerId).some((p) => p.profileId === target.profileId),
            );
            if (request.group === group && profilesExist) {
                await accessor
                    .get(TestServiceDIToken)
                    .runResolvedTests({ targets: request.targets, group, exclude: request.exclude });
                return;
            }
            await runTestIds(
                accessor,
                request.targets.flatMap((target) => target.testIds),
                group,
            );
        },
    };
}

/** Upstream `ReRunLastRun`. */
export const reRunLastRunAction = lastRunAction(
    TestRunProfileBitset.Run,
    "testing.reRunLastRun",
    "Rerun Last Run",
    "mod+; l",
);

/** Upstream `DebugLastRun`. */
export const debugLastRunAction = lastRunAction(
    TestRunProfileBitset.Debug,
    "testing.debugLastRun",
    "Debug Last Run",
    "mod+; mod+l",
);

/** Upstream `RunOrDebugFailedFromLastRun`: the tests that failed in the run, with the group's defaults. */
function failedFromLastRunAction(group: TestRunProfileGroup, id: string, label: string): CommandAction {
    return {
        id,
        title: `Test: ${label}`,
        shortTitle: label,
        enablement: HAS_RESULTS,
        async run(accessor, runId) {
            const last = lastRun(accessor, runId);
            if (last === undefined) return;
            const failed = [...last.tests].filter((test) => isFailedState(test.ownComputedState));
            await runTestIds(
                accessor,
                failed.map((test) => test.item.extId),
                group,
            );
        },
    };
}

/** Upstream `ReRunFailedFromLastRun`. */
export const reRunFailedFromLastRunAction = failedFromLastRunAction(
    TestRunProfileBitset.Run,
    "testing.reRunFailedFromLastRun",
    "Rerun Failed Tests from Last Run",
);

/** Upstream `DebugFailedFromLastRun`. */
export const debugFailedFromLastRunAction = failedFromLastRunAction(
    TestRunProfileBitset.Debug,
    "testing.debugFailedFromLastRun",
    "Debug Failed Tests from Last Run",
);

/** Upstream `ClearTestResultsAction`: in the Test Explorer's "⋯", in the TEST RESULTS title. */
export const clearTestResultsAction: CommandAction = {
    id: "testing.clearTestResults",
    title: "Test: Clear All Results",
    shortTitle: "Clear All Results",
    enablement: HAS_RESULTS,
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "displayAction",
            order: ActionOrder.ClearResults,
            icon: codicon("clear-all"),
            visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
        },
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: ActionOrder.ClearResults,
            icon: codicon("clear-all"),
            visible: viewMenuVisible(TEST_RESULTS_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(TestResultServiceDIToken).clear();
    },
};

/** Upstream `ShowMostRecentOutputAction`: TEST RESULTS with the latest run's first task; in the Test Explorer title. */
export const showMostRecentOutputAction: CommandAction = {
    id: "testing.showMostRecentOutput",
    title: "Test: Show Output",
    shortTitle: "Show Output",
    keybinding: { keys: parseChord("mod+; mod+o"), weight: KeybindingWeight.WorkbenchContrib },
    enablement: HAS_RESULTS,
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: ActionOrder.Collapse,
            icon: codicon("terminal"),
            visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
        },
        { menuId: MenuId.CommandPalette, when: HAS_RESULTS },
    ],
    run(accessor) {
        accessor.get(ViewsServiceDIToken).openView(TEST_RESULTS_VIEW_ID, true);
        accessor.get(TestResultsComponentDIToken).showLatestRun();
    },
};

/** Upstream `ToggleResultsViewLayoutAction`: `testing.resultsView.layout` the other way. */
export const toggleResultsViewLayoutAction: CommandAction = {
    id: "testing.toggleResultsViewLayout",
    title: "Test: Toggle Tree Position",
    shortTitle: "Toggle Tree Position",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: ActionOrder.DisplayMode,
            icon: codicon("arrow-swap"),
            visible: viewMenuVisible(TEST_RESULTS_VIEW_ID),
        },
    ],
    run(accessor) {
        return accessor.get(TestResultsComponentDIToken).toggleLayout();
    },
};

/**
 * Upstream `CollapsePeekStack`: the shown message folds, its stack takes the content. Upstream puts it in the peek's
 * title, which we do not have: here it is in the TEST RESULTS title while the shown message has a stack.
 */
export const collapsePeekStackAction: CommandAction = {
    id: "testing.collapsePeekStack",
    title: "Test: Collapse Stack Frames",
    shortTitle: "Collapse Stack Frames",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: ActionOrder.Collapse,
            icon: codicon("collapse-all"),
            visible: viewMenuVisible(TEST_RESULTS_VIEW_ID),
            when: PEEK_HAS_STACK,
        },
        { menuId: MenuId.CommandPalette, when: PEEK_HAS_STACK },
    ],
    run(accessor) {
        accessor.get(TestResultsComponentDIToken).message.collapseStack();
    },
};

/** Upstream `CollapseAllAction`: in the `displayAction` group, so in "⋯". */
export const collapseAllTestsAction: CommandAction = {
    id: "testing.collapseAll",
    title: "Collapse All Tests",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "displayAction",
            order: ActionOrder.Collapse,
            icon: codicon("collapse-all"),
            visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
        },
    ],
    run(accessor) {
        return accessor.get(TestingExplorerComponentDIToken).collapseAll();
    },
};

/** Upstream `TestingSortBy*Action`: the `sortBy` group of "⋯", the current one checked. */
function sortAction(sorting: TestExplorerViewSorting, id: string, title: string): CommandAction {
    return {
        id,
        title,
        menus: [
            {
                menuId: MenuId.ViewTitle,
                group: "sortBy",
                order: ActionOrder.Sort,
                visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
                toggled: `testing.explorerViewSorting == '${sorting}'`,
            },
        ],
        run(accessor) {
            accessor.get(TestingExplorerComponentDIToken).setSorting(sorting);
        },
    };
}

export const sortByStatusAction = sortAction("status", "testing.sortByStatus", "Sort by Status");
export const sortByLocationAction = sortAction("location", "testing.sortByLocation", "Sort by Location");
export const sortByDurationAction = sortAction("duration", "testing.sortByDuration", "Sort by Duration");

/**
 * Upstream `GoToTest`: the row's test from its menu, the focused one from the key; the keyboard goes to the editor.
 * Inline on the row as well, a decision of the spec (upstream has it in the context menu only).
 */
export const goToTestAction: CommandAction = {
    id: "testing.editFocusedTest",
    title: "Go to Test",
    keybinding: { keys: parseKeybinding("alt+enter"), when: `focusedView == '${TESTING_EXPLORER_VIEW_ID}'` },
    // Upstream's weight: under the editor contributions, above the core.
    weight: KeybindingWeight.EditorContrib - 10,
    menus: testItemInlineAndInContext(ActionOrder.GoToTest, codicon("go-to-file"), "testing.testItemHasUri"),
    run(accessor, arg) {
        const testId = argTestId(accessor, arg);
        if (testId !== undefined) accessor.get(TestingExplorerComponentDIToken).goToTest(testId, false);
    },
};

/** Upstream `SearchForTestExtension`. */
export const searchForTestExtensionAction: CommandAction = {
    id: "testing.searchForTestExtension",
    title: "Search for Test Extension",
    run(accessor) {
        openExtensionsSearch(accessor, '@category:"testing"');
    },
};

/** Upstream's `allTestActions` order for what is ported (the palette lists them so). */
export const TESTING_ACTIONS: readonly CommandAction[] = [
    showTestingAction,
    refreshTestsAction,
    cancelTestRefreshAction,
    cancelTestRunAction,
    clearTestResultsAction,
    collapseAllTestsAction,
    debugTestAction,
    debugAllTestsAction,
    debugFailedTestsAction,
    debugLastRunAction,
    debugSelectedTestsAction,
    goToTestAction,
    reRunFailedTestsAction,
    reRunLastRunAction,
    runTestAction,
    runAllTestsAction,
    runSelectedTestsAction,
    searchForTestExtensionAction,
    showMostRecentOutputAction,
    sortByDurationAction,
    sortByLocationAction,
    sortByStatusAction,
    toggleResultsViewLayoutAction,
    collapsePeekStackAction,
    reRunFailedFromLastRunAction,
    debugFailedFromLastRunAction,
];
