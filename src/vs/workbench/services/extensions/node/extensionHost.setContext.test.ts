import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
    registerAndActivate,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { SetContextCommandContribution } from "../../../browser/setContextCommandContribution.ts";

/**
 * Сквозной путь команды `setContext`: расширение в субпроцессе →
 * `commands.executeCommand` по RPC → `CommandServiceAdapter` → host-реестр →
 * {@link SetContextCommandContribution} → when-контекст. Половины этого пути
 * (реестр↔контекст и расширение↔RPC) закрыты по отдельности; здесь важно, что
 * они состыкованы — раньше вызов отклонялся как «команда не найдена», и все
 * `when` расширений были мертвы.
 */
async function harnessWithSetContext(): Promise<{
    harness: IExtensionHarness;
    contextKeys: ContextKeyService;
}> {
    // activateEvents: [] — команда должна стоять в реестре ДО активации:
    // расширение дёргает её прямо из activate().
    const harness = await createExtensionTestHarness({ activateEvents: [] });
    const contextKeys = new ContextKeyService();
    // Команда живёт в host-реестре — том самом, за которым стоит ExtensionHost.
    new SetContextCommandContribution(harness.commandRegistry, contextKeys);
    await registerAndActivate(harness.host, extensionFixture("test.setctx", "setsContext.cjs"));
    return { harness, contextKeys };
}

describe("ExtensionHost — команда setContext", () => {
    it("вызов из activate() доезжает до when-контекста", async () => {
        const { harness, contextKeys } = await harnessWithSetContext();
        try {
            expect(contextKeys.evaluate("testExt.activated")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("вызов из команды расширения переключает ключ в обе стороны", async () => {
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

    it("строковое значение сравнивается в when-выражении", async () => {
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
