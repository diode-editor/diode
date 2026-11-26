import { describe, expect, it } from "vitest";

import { makeTestingServices } from "../../../../../TestUtils/testingServices.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import {
    ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { formatKeybinding, KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { ExtensionsComponentDIToken } from "../../extensions/browser/extensionsComponent.ts";
import { TestServiceDIToken } from "../common/testService.ts";

import { TESTING_ACTIONS } from "./testingActions.ts";
import { TestingExplorerComponentDIToken } from "./testingExplorerView.ts";

function setup() {
    const contextKeys = new ContextKeyService();
    const { tests } = makeTestingServices({ contextKeys });
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const accessor = {
        get: (token: unknown) => (token === TestServiceDIToken ? tests : contextKeys),
    } as unknown as ServiceAccessor;
    for (const action of TESTING_ACTIONS) registerAction(commands, keybindings, accessor, action);
    const refreshes: string[] = [];
    const finishers: (() => void)[] = [];
    const register = (id: string, canRefresh: boolean): void => {
        tests.registerTestController({
            id,
            label: id,
            canRefresh,
            expandTest: () => Promise.resolve(),
            runTests: () => Promise.resolve([]),
            cancelTestRun: () => undefined,
            refreshTests: (token) =>
                new Promise<void>((resolve) => {
                    refreshes.push(id);
                    finishers.push(resolve);
                    token.onCancellationRequested(() => {
                        refreshes.push(`${id}:cancelled`);
                    });
                }),
        });
    };
    const finish = (): void => {
        for (const resolve of finishers) resolve();
    };
    return { contextKeys, commands, keybindings, register, refreshes, finish };
}

describe("testing actions", () => {
    it("titles, category and the upstream chord, gated on testing.canRefresh", () => {
        const { commands, keybindings } = setup();
        expect(commands.getTitle("testing.refreshTests")).toBe("Test: Refresh Tests");
        expect(commands.getTitle("testing.cancelTestRefresh")).toBe("Test: Cancel Test Refresh");
        const binding = keybindings.listBindings().find((entry) => entry.commandId === "testing.refreshTests");
        expect(binding?.when).toContain("testing.canRefresh");
        expect(formatKeybinding(binding?.chord ?? [], "pc")).toBe("Ctrl+; Ctrl+R");
    });

    it("Refresh Tests does nothing until a controller can refresh, then refreshes; Cancel cancels the token", async () => {
        const { contextKeys, commands, register, refreshes, finish } = setup();
        register("plain", false);
        await commands.execute("testing.refreshTests");
        await commands.execute("testing.cancelTestRefresh");
        expect(refreshes).toEqual([]);
        register("vitest", true);
        const refreshing = commands.execute("testing.refreshTests");
        expect(contextKeys.get("testing.isRefreshing")).toBe(true);
        await commands.execute("testing.cancelTestRefresh");
        // Every controller is asked, as upstream: the extension side answers at once without a handler.
        expect(refreshes).toEqual(["plain", "vitest", "plain:cancelled", "vitest:cancelled"]);
        expect(contextKeys.get("testing.isRefreshing")).toBe(false);
        finish();
        await refreshing;
    });
});

describe("testing actions — the Test Explorer", () => {
    function run(id: string, services: ReadonlyMap<unknown, unknown>, ...args: unknown[]): unknown {
        const commands = new CommandRegistry();
        const accessor = { get: (token: unknown) => services.get(token) } as unknown as ServiceAccessor;
        for (const action of TESTING_ACTIONS) registerAction(commands, new KeybindingRegistry(), accessor, action);
        return commands.execute(id, ...args);
    }

    it("View: Show Testing opens the container with the focus, from the View menu without a key", () => {
        const opened: [string, boolean][] = [];
        const views = { openViewContainer: (id: string, focus: boolean) => opened.push([id, focus]) };
        run("workbench.view.extension.test", new Map([[ViewsServiceDIToken, views]]));
        expect(opened).toEqual([["workbench.view.extension.test", true]]);
        const action = TESTING_ACTIONS.find((entry) => entry.id === "workbench.view.extension.test");
        expect(action?.keybinding).toBeUndefined();
        expect(action?.menus?.map((menu) => [menu.menuId, menu.group])).toEqual([[MenuId.MenubarViewMenu, "3_views"]]);
    });

    it("Install Additional Test Extensions searches the marketplace's testing category", () => {
        const shown: string[] = [];
        const queries: string[] = [];
        run(
            "testing.searchForTestExtension",
            new Map<unknown, unknown>([
                [SidebarServiceDIToken, { showViewlet: (id: string) => shown.push(id) }],
                [ExtensionsComponentDIToken, { setQuery: (query: string) => queries.push(query) }],
            ]),
        );
        expect(shown).toEqual(["extensions"]);
        expect(queries).toEqual(['@category:"testing"']);
    });

    it("Go to Test takes the row's test from a menu, the test under the cursor from the key; the keyboard goes to the editor", () => {
        const gone: [string, boolean][] = [];
        const explorer = {
            focusedTestId: "vitest\0focused",
            goToTest: (testId: string, preserveFocus: boolean) => gone.push([testId, preserveFocus]),
        };
        const services = new Map([[TestingExplorerComponentDIToken, explorer]]);
        run("testing.editFocusedTest", services, { $testId: "vitest\0row" });
        run("testing.editFocusedTest", services);
        expect(gone).toEqual([
            ["vitest\0row", false],
            ["vitest\0focused", false],
        ]);
        run(
            "testing.editFocusedTest",
            new Map([[TestingExplorerComponentDIToken, { ...explorer, focusedTestId: undefined }]]),
        );
        expect(gone).toHaveLength(2);
    });

    it("Go to Test is Alt+Enter in the Test Explorer", () => {
        const keybindings = new KeybindingRegistry();
        const accessor = { get: () => undefined } as unknown as ServiceAccessor;
        for (const action of TESTING_ACTIONS) registerAction(new CommandRegistry(), keybindings, accessor, action);
        const binding = keybindings.listBindings().find((entry) => entry.commandId === "testing.editFocusedTest");
        expect(formatKeybinding(binding?.chord ?? [], "pc")).toBe("Alt+Enter");
        expect(binding?.when).toBe("focusedView == 'workbench.view.testing'");
    });
});
