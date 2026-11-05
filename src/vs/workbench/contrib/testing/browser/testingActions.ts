import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import type { IWireTestItemArg } from "../../../api/common/testingWireTypes.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { EXTENSIONS_VIEWLET_ID, ExtensionsComponentDIToken } from "../../extensions/browser/extensionsComponent.ts";
import { TestServiceDIToken } from "../common/testService.ts";

import {
    TESTING_EXPLORER_VIEW_ID,
    TESTING_VIEWLET_ID,
    TestingExplorerComponentDIToken,
} from "./testingExplorerView.ts";

const CAN_REFRESH = "testing.canRefresh";

/** Upstream `ActionOrder.Refresh`/`Collapse` are positions in their groups; ours sit alone in theirs. */
const REFRESH_ORDER = 10;

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
            order: REFRESH_ORDER,
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
            order: REFRESH_ORDER,
            icon: codicon("stop"),
            visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
            when: `${CAN_REFRESH} && testing.isRefreshing`,
        },
    ],
    run(accessor) {
        accessor.get(TestServiceDIToken).cancelRefreshTests();
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
            icon: codicon("collapse-all"),
            visible: viewMenuVisible(TESTING_EXPLORER_VIEW_ID),
        },
    ],
    run(accessor) {
        return accessor.get(TestingExplorerComponentDIToken).collapseAll();
    },
};

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
    menus: [
        {
            menuId: MenuId.TestItem,
            group: "inline",
            order: 1,
            icon: codicon("go-to-file"),
            when: "testing.testItemHasUri",
        },
        { menuId: MenuId.TestItem, group: "builtin", order: 1, when: "testing.testItemHasUri" },
    ],
    run(accessor, arg) {
        const explorer = accessor.get(TestingExplorerComponentDIToken);
        const testId = (arg as Partial<IWireTestItemArg> | undefined)?.$testId ?? explorer.focusedTestId;
        if (typeof testId === "string") explorer.goToTest(testId, false);
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

export const TESTING_ACTIONS: readonly CommandAction[] = [
    showTestingAction,
    refreshTestsAction,
    cancelTestRefreshAction,
    collapseAllTestsAction,
    goToTestAction,
    searchForTestExtensionAction,
];
