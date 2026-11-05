import { describe, expect, it } from "vitest";

import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import {
    ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { formatKeybinding, KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { TestService, TestServiceDIToken } from "../common/testService.ts";

import { TESTING_ACTIONS } from "./testingActions.ts";

function setup() {
    const contextKeys = new ContextKeyService();
    const tests = new TestService(contextKeys);
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
