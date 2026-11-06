import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { type IWireTestItemArg, TestItemExpandState } from "../../../api/common/testingWireTypes.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { EXTENSIONS_VIEWLET_ID, ExtensionsComponentDIToken } from "../../extensions/browser/extensionsComponent.ts";
import { isFailedState } from "../common/testingStates.ts";
import { TestProfileServiceDIToken } from "../common/testProfileService.ts";
import type { LiveTestResult } from "../common/testResult.ts";
import { TestResultServiceDIToken } from "../common/testResultService.ts";
import { type ITestNode, TestServiceDIToken } from "../common/testService.ts";

import {
    type TestExplorerViewSorting,
    TESTING_EXPLORER_VIEW_ID,
    TESTING_VIEWLET_ID,
    TestingExplorerComponentDIToken,
} from "./testingExplorerView.ts";

const CAN_REFRESH = "testing.canRefresh";
const IS_RUNNING = "testing.isRunning";
const HAS_RUNNABLE = "testing.hasRunnableTests";
const HAS_RESULTS = "testing.hasAnyResults";

/** Upstream `ActionOrder`: positions in the title's navigation and in the row's menus. */
const ActionOrder = {
    Refresh: 10,
    Run: 11,
    Collapse: 16,
    ClearResults: 17,
    Sort: 19,
    GoToTest: 20,
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

/** Upstream `discoverAndRunTests` without the discovery: the ids the mirror knows run with their defaults. */
async function runTestIds(accessor: ServiceAccessor, testIds: Iterable<string>): Promise<void> {
    const tests = accessor.get(TestServiceDIToken);
    const nodes = [...testIds].flatMap((testId) => tests.getNodeById(testId) ?? []);
    if (nodes.length > 0) await tests.runTests({ tests: nodes });
}

/** The latest run, or the one `runId` names. */
function lastRun(accessor: ServiceAccessor, runId: unknown): LiveTestResult | undefined {
    const { results } = accessor.get(TestResultServiceDIToken);
    return typeof runId === "string" ? results.find((result) => result.id === runId) : results.at(0);
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
 * Upstream `RunSelectedAction` ("Run Tests"): the tests the view shows — without a filter all of them, with one
 * those it matched. In the title while nothing runs; Cancel Test Run takes the slot meanwhile.
 */
export const runSelectedTestsAction: CommandAction = {
    id: "testing.runSelected",
    title: "Test: Run Tests",
    shortTitle: "Run Tests",
    enablement: HAS_RUNNABLE,
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: ActionOrder.Run,
            icon: codicon("run-all"),
            visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
            when: `!${IS_RUNNING} && ${HAS_RUNNABLE}`,
        },
    ],
    async run(accessor) {
        const { include, exclude } = accessor.get(TestingExplorerComponentDIToken).getTreeIncludeExclude();
        await accessor.get(TestServiceDIToken).runTests({ tests: include, exclude });
    },
};

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

/** Upstream `RunAction`: the row's test with its visible descendants; inline and in the row's menu. */
export const runTestAction: CommandAction = {
    id: "testing.run",
    title: "Test: Run Test",
    shortTitle: "Run Test",
    enablement: HAS_RUNNABLE,
    menus: testItemInlineAndInContext(ActionOrder.Run, codicon("run"), HAS_RUNNABLE),
    async run(accessor, arg) {
        const testId = argTestId(accessor, arg);
        const node = testId === undefined ? undefined : accessor.get(TestServiceDIToken).getNodeById(testId);
        if (node === undefined) return;
        const { include, exclude } = accessor.get(TestingExplorerComponentDIToken).getTreeIncludeExclude([node]);
        await accessor.get(TestServiceDIToken).runTests({ tests: include, exclude });
    },
};

/** Upstream `RunAllAction`: every controller that has or may have tests. */
export const runAllTestsAction: CommandAction = {
    id: "testing.runAll",
    title: "Test: Run All Tests",
    shortTitle: "Run All Tests",
    keybinding: parseChord("mod+; a"),
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
                message: "No tests found in this workspace. You may need to install a test provider extension",
                modal: false,
                items: [],
            });
            return;
        }
        await tests.runTests({ tests: roots });
    },
};

/** Upstream `ReRunFailedTests`: the tests whose latest result over all runs failed. */
export const reRunFailedTestsAction: CommandAction = {
    id: "testing.reRunFailTests",
    title: "Test: Rerun Failed Tests",
    shortTitle: "Rerun Failed Tests",
    keybinding: parseChord("mod+; e"),
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
        await runTestIds(accessor, failed);
    },
};

/** Upstream `ReRunLastRun`: the same targets with the same profiles while they exist, otherwise the defaults. */
export const reRunLastRunAction: CommandAction = {
    id: "testing.reRunLastRun",
    title: "Test: Rerun Last Run",
    shortTitle: "Rerun Last Run",
    keybinding: parseChord("mod+; l"),
    enablement: HAS_RESULTS,
    async run(accessor, runId) {
        const last = lastRun(accessor, runId);
        if (last === undefined) return;
        const { request } = last;
        const profiles = accessor.get(TestProfileServiceDIToken);
        const profilesExist = request.targets.every((target) =>
            profiles.getControllerProfiles(target.controllerId).some((p) => p.profileId === target.profileId),
        );
        if (profilesExist) {
            await accessor
                .get(TestServiceDIToken)
                .runResolvedTests({ targets: request.targets, group: request.group, exclude: request.exclude });
            return;
        }
        await runTestIds(
            accessor,
            request.targets.flatMap((target) => target.testIds),
        );
    },
};

/** Upstream `ReRunFailedFromLastRun`. */
export const reRunFailedFromLastRunAction: CommandAction = {
    id: "testing.reRunFailedFromLastRun",
    title: "Test: Rerun Failed Tests from Last Run",
    shortTitle: "Rerun Failed Tests from Last Run",
    enablement: HAS_RESULTS,
    async run(accessor, runId) {
        const last = lastRun(accessor, runId);
        if (last === undefined) return;
        const failed = [...last.tests].filter((test) => isFailedState(test.ownComputedState));
        await runTestIds(
            accessor,
            failed.map((test) => test.item.extId),
        );
    },
};

/** Upstream `ClearTestResultsAction`: in "⋯". */
export const clearTestResultsAction: CommandAction = {
    id: "testing.clearTestResults",
    title: "Test: Clear All Results",
    shortTitle: "Clear All Results",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "displayAction",
            order: ActionOrder.ClearResults,
            icon: codicon("clear-all"),
            visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(TestResultServiceDIToken).clear();
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

/**
 * Upstream `SearchForTestExtension` opens the marketplace with `@category:"testing"`; our search has no categories, so
 * it searches for the word (a deviation).
 */
export const searchForTestExtensionAction: CommandAction = {
    id: "testing.searchForTestExtension",
    title: "Search for Test Extension",
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(EXTENSIONS_VIEWLET_ID);
        accessor.get(ExtensionsComponentDIToken).setQuery("testing");
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
    goToTestAction,
    reRunFailedTestsAction,
    reRunLastRunAction,
    runTestAction,
    runAllTestsAction,
    runSelectedTestsAction,
    searchForTestExtensionAction,
    sortByDurationAction,
    sortByLocationAction,
    sortByStatusAction,
    reRunFailedFromLastRunAction,
];
