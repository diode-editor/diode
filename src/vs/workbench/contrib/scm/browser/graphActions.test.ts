import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";

import { scmGraphRefreshAction } from "./graphActions.ts";

function makeAccessor(commands: CommandRegistry): ServiceAccessor {
    return { get: () => commands } as unknown as ServiceAccessor;
}

describe("scmGraphRefreshAction", () => {
    it("делегирует git.refresh, когда команда расширения зарегистрирована", () => {
        const commands = new CommandRegistry();
        let refreshed = 0;
        commands.register("git.refresh", () => {
            refreshed++;
        });
        scmGraphRefreshAction.run(makeAccessor(commands));
        expect(refreshed).toBe(1);
    });

    it("до активации расширения — тихий no-op", () => {
        const commands = new CommandRegistry();
        expect(() => scmGraphRefreshAction.run(makeAccessor(commands))).not.toThrow();
    });
});
