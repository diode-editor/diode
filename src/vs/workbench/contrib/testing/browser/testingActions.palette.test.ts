import { describe, expect, it } from "vitest";

import { makeTestingServices } from "../../../../../TestUtils/testingServices.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { TestServiceDIToken } from "../common/testService.ts";

import { TESTING_ACTIONS } from "./testingActions.ts";

// The command palette lists a command only while its enablement holds (commandsQuickAccessProvider). Upstream shows
// the result commands in the palette only with `testing.hasAnyResults`: the reruns and Clear All Results alike.

function paletteIds(hasAnyResults: boolean): string[] {
    const contextKeys = new ContextKeyService();
    const { tests } = makeTestingServices({ contextKeys });
    contextKeys.set("testing.hasAnyResults", hasAnyResults);
    const commands = new CommandRegistry();
    const accessor = {
        get: (token: unknown) => (token === TestServiceDIToken ? tests : contextKeys),
    } as unknown as ServiceAccessor;
    for (const action of TESTING_ACTIONS) registerAction(commands, new KeybindingRegistry(), accessor, action);
    return commands
        .listCommands()
        .filter((cmd) => cmd.enablement === undefined || contextKeys.evaluate(cmd.enablement))
        .map((cmd) => cmd.id);
}

describe("Testing commands in the palette", () => {
    it("without results Clear All Results is not offered, like the reruns", () => {
        const ids = paletteIds(false);
        expect(ids).not.toContain("testing.reRunLastRun");
        expect(ids).not.toContain("testing.clearTestResults");
        expect(paletteIds(true)).toContain("testing.clearTestResults");
    });
});
