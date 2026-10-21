import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
    registerAndActivate,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { SetContextCommandContribution } from "../../../browser/setContextCommandContribution.ts";

// The seam between two path halves tested separately: without it `setContext` was rejected
// with "command not found", and every extension `when` clause was dead.
async function harnessWithSetContext(): Promise<{
    harness: IExtensionHarness;
    contextKeys: ContextKeyService;
}> {
    // activateEvents: [] — the command must be in the registry BEFORE activation:
    // the extension calls it straight from activate().
    const harness = await createExtensionTestHarness({ activateEvents: [] });
    const contextKeys = new ContextKeyService();
    new SetContextCommandContribution(harness.commandRegistry, contextKeys);
    await registerAndActivate(harness.host, extensionFixture("test.setctx", "setsContext.cjs"));
    return { harness, contextKeys };
}

describe("ExtensionHost — setContext command", () => {
    it("a call from activate() reaches the when context", async () => {
        const { harness, contextKeys } = await harnessWithSetContext();
        try {
            expect(contextKeys.evaluate("testExt.activated")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("a call from an extension command toggles the key both ways", async () => {
        const { harness, contextKeys } = await harnessWithSetContext();
        try {
            expect(contextKeys.evaluate("testExt.armed")).toBe(false);

            await harness.commandRegistry.execute("test.setctx.arm");
            expect(contextKeys.evaluate("testExt.armed")).toBe(true);

            await harness.commandRegistry.execute("test.setctx.disarm");
            expect(contextKeys.evaluate("testExt.armed")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("a string value is compared in a when expression", async () => {
        const { harness, contextKeys } = await harnessWithSetContext();
        try {
            await harness.commandRegistry.execute("test.setctx.setMode", "chat");
            expect(contextKeys.evaluate("testExt.mode == 'chat'")).toBe(true);
            expect(contextKeys.evaluate("testExt.mode == 'inline'")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });
});
