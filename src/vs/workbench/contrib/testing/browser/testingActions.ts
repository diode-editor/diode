import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { TestServiceDIToken } from "../common/testService.ts";

const CAN_REFRESH = "testing.canRefresh";

/** Upstream `RefreshTestsAction`: every controller's `refreshHandler`; without one the command is unavailable. */
export const refreshTestsAction: CommandAction = {
    id: "testing.refreshTests",
    title: "Test: Refresh Tests",
    shortTitle: "Refresh Tests",
    keybinding: { keys: parseChord("mod+; mod+r"), when: CAN_REFRESH },
    enablement: CAN_REFRESH,
    async run(accessor) {
        await accessor.get(TestServiceDIToken).refreshTests();
    },
};

/** Upstream `CancelTestRefreshAction`: cancels the tokens of the refreshes in flight. */
export const cancelTestRefreshAction: CommandAction = {
    id: "testing.cancelTestRefresh",
    title: "Test: Cancel Test Refresh",
    shortTitle: "Cancel Test Refresh",
    enablement: CAN_REFRESH,
    run(accessor) {
        accessor.get(TestServiceDIToken).cancelRefreshTests();
    },
};

export const TESTING_ACTIONS: readonly CommandAction[] = [refreshTestsAction, cancelTestRefreshAction];
