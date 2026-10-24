import { describe, expect, it } from "vitest";

import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import {
    ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ProgressService, ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { CommandsQuickAccessProvider } from "../../quickaccess/browser/commandsQuickAccessProvider.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

import { gitRefreshAction, REFRESH_ICON } from "./refreshActions.ts";
import { SCM_ACTIONS } from "./scmActions.ts";

function makeAccessor(
    commands: CommandRegistry,
    progress = new ProgressService(),
    notices: string[] = [],
): ServiceAccessor {
    const services = new Map<unknown, unknown>([
        [CommandRegistryDIToken, commands],
        [ProgressServiceDIToken, progress],
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
    return { get: (t: unknown) => services.get(t) } as unknown as ServiceAccessor;
}

describe("gitRefreshAction", () => {
    it("is VS Code's git.refresh: palette title, gated on a repository", () => {
        expect(gitRefreshAction.id).toBe("git.refresh");
        expect(gitRefreshAction.title).toBe("Git: Refresh");
        expect(gitRefreshAction.shortTitle).toBe("Refresh");
        expect(gitRefreshAction.enablement).toBe("gitHasRepo");
    });

    it("a refresh icon in the CHANGES title only, and only in a repository", () => {
        expect(gitRefreshAction.menus).toHaveLength(1);
        const [placement] = gitRefreshAction.menus!;
        expect(placement).toMatchObject({
            menuId: MenuId.ViewTitle,
            group: "navigation",
            icon: REFRESH_ICON,
            when: "gitHasRepo",
        });
        expect(REFRESH_ICON).toBe("\ueb37");
        expect(placement.visible?.({ view: SCM_CHANGES_VIEW_ID })).toBe(true);
        expect(placement.visible?.({ view: SCM_GRAPH_VIEW_ID })).toBe(false);
    });

    it("sends the refresh op and keeps the CHANGES spinner until it settles", async () => {
        const commands = new CommandRegistry();
        const payloads: unknown[] = [];
        let release!: () => void;
        commands.register(GIT_OP_COMMAND, (payload) => {
            payloads.push(payload);
            return new Promise(
                (resolve) =>
                    (release = () => {
                        resolve({ ok: true });
                    }),
            );
        });
        const progress = new ProgressService({ delayMs: 0, minVisibleMs: 0, intervalMs: 100 });

        const running = gitRefreshAction.run(makeAccessor(commands, progress)) as Promise<void>;
        // A zero show delay is still a timer: wait for a macrotask.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(payloads).toEqual([{ op: "refresh", params: undefined }]);
        expect(progress.isBusy(SCM_CHANGES_VIEW_ID)).toBe(true);
        expect(progress.isBusy(SCM_GRAPH_VIEW_ID)).toBe(false);
        expect(progress.viewProgress().get(SCM_CHANGES_VIEW_ID)?.title).toBe("Refreshing…");

        release();
        await running;
        expect(progress.isBusy()).toBe(false);
        progress.dispose();
    });

    it("before the extension activates: silent no-op, no spinner and no notice", async () => {
        const progress = new ProgressService();
        const notices: string[] = [];
        await expect(
            gitRefreshAction.run(makeAccessor(new CommandRegistry(), progress, notices)),
        ).resolves.toBeUndefined();
        expect(progress.isBusy()).toBe(false);
        expect(notices).toEqual([]);
    });
});

describe("Git: Refresh in the command palette", () => {
    // The palette as the user opens it: the shipped action (busy enablement included) registered the
    // way the workbench registers it, then `>Git: Refresh` typed.
    function paletteLabels(hasRepo: boolean): string[] {
        const commands = new CommandRegistry();
        const contextKeys = new ContextKeyService();
        contextKeys.set("gitHasRepo", hasRepo);
        const services = new Map<unknown, unknown>([[ContextKeyServiceDIToken, contextKeys]]);
        const accessor = { get: (t: unknown) => services.get(t) } as unknown as ServiceAccessor;
        const action = SCM_ACTIONS.find((a) => a.id === "git.refresh")!;
        registerAction(commands, new KeybindingRegistry(), accessor, action);
        const provider = new CommandsQuickAccessProvider(commands, new KeybindingRegistry(), contextKeys);
        return provider.getItems(">Git: Refresh").map((item) => item.label);
    }

    it("is listed inside a repository", () => {
        expect(paletteLabels(true)).toEqual(["Git: Refresh"]);
    });

    it("is absent outside a repository", () => {
        expect(paletteLabels(false)).toEqual([]);
    });
});
