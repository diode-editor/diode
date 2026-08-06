import { describe, expect, it } from "vitest";

import { CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";

import { scmGraphLoadMoreAction, scmGraphRefreshAction } from "./graphActions.ts";

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

describe("scmGraphLoadMoreAction", () => {
    it("просит расширение расширить страницу истории", async () => {
        const ops: unknown[] = [];
        const services = new Map<unknown, unknown>([
            [
                CommandRegistryDIToken,
                {
                    has: () => true,
                    execute: (id: string, payload: unknown) => {
                        expect(id).toBe(GIT_OP_COMMAND);
                        ops.push(payload);
                        return { ok: true };
                    },
                },
            ],
        ]);
        const accessor = { get: (t: unknown) => services.get(t) } as unknown as ServiceAccessor;

        await scmGraphLoadMoreAction.run(accessor);
        expect(ops).toEqual([{ op: "logLoadMore", params: undefined }]);
    });

    it("без git-расширения — тихий no-op, без notice в статус-баре", async () => {
        const notices: string[] = [];
        const services = new Map<unknown, unknown>([
            [CommandRegistryDIToken, { has: () => false, execute: () => undefined }],
            [
                StatusBarServiceDIToken,
                {
                    addEntry: (entry: { text: string }) => {
                        notices.push(entry.text);
                        return { dispose: () => undefined };
                    },
                },
            ],
        ]);
        const accessor = { get: (t: unknown) => services.get(t) } as unknown as ServiceAccessor;

        await expect(scmGraphLoadMoreAction.run(accessor)).resolves.toBeUndefined();
        expect(notices).toEqual([]);
    });
});
