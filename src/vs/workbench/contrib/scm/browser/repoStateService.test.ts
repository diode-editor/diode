import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { PUBLISH_REPO_STATE_COMMAND, ScmRepoStateService } from "./repoStateService.ts";

function setup(): { service: ScmRepoStateService; commands: CommandRegistry; contextKeys: ContextKeyService } {
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    const service = new ScmRepoStateService(commands, contextKeys);
    return { service, commands, contextKeys };
}

const STATE = {
    branch: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 1,
    behind: 2,
    remotes: ["origin"],
    state: "idle",
};

describe("ScmRepoStateService", () => {
    it("до публикации — «репозитория нет», все git-ключи false", () => {
        const { service, contextKeys } = setup();
        expect(service.hasRepository).toBe(false);
        expect(service.state.branch).toBeNull();
        expect(contextKeys.get("gitHasRepo")).toBe(false);
        expect(contextKeys.get("gitHasRemotes")).toBe(false);
        expect(contextKeys.get("gitHasUpstream")).toBe(false);
    });

    it("публикация выставляет снимок, событие и when-ключи", () => {
        const { service, commands, contextKeys } = setup();
        const changed = vi.fn();
        service.onDidChangeState(changed);

        commands.execute(PUBLISH_REPO_STATE_COMMAND, STATE);

        expect(changed).toHaveBeenCalledTimes(1);
        expect(service.hasRepository).toBe(true);
        expect(service.state).toEqual(STATE);
        expect(contextKeys.get("gitHasRepo")).toBe(true);
        expect(contextKeys.get("gitHasRemotes")).toBe(true);
        expect(contextKeys.get("gitHasUpstream")).toBe(true);
        expect(contextKeys.get("gitMerging")).toBe(false);
        expect(contextKeys.get("gitDetached")).toBe(false);
    });

    it("merge/rebase/detached отражаются в своих ключах", () => {
        const { commands, contextKeys } = setup();
        commands.execute(PUBLISH_REPO_STATE_COMMAND, {
            ...STATE,
            branch: null,
            detached: true,
            upstream: null,
            remotes: [],
            state: "merging",
        });
        expect(contextKeys.get("gitMerging")).toBe(true);
        expect(contextKeys.get("gitDetached")).toBe(true);
        expect(contextKeys.get("gitHasRemotes")).toBe(false);
        expect(contextKeys.get("gitHasUpstream")).toBe(false);

        commands.execute(PUBLISH_REPO_STATE_COMMAND, { ...STATE, state: "rebasing" });
        expect(contextKeys.get("gitRebasing")).toBe(true);
        expect(contextKeys.get("gitMerging")).toBe(false);
    });

    it("идентичная повторная публикация гасится, мусор отбрасывается", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        service.onDidChangeState(changed);

        commands.execute(PUBLISH_REPO_STATE_COMMAND, STATE);
        commands.execute(PUBLISH_REPO_STATE_COMMAND, STATE);
        expect(changed).toHaveBeenCalledTimes(1);

        for (const garbage of [
            null,
            42,
            { ...STATE, detached: "no" },
            { ...STATE, ahead: "1" },
            { ...STATE, branch: 5 },
            { ...STATE, upstream: 5 },
            { ...STATE, remotes: "origin" },
            { ...STATE, remotes: [1] },
            { ...STATE, state: "flying" },
        ]) {
            commands.execute(PUBLISH_REPO_STATE_COMMAND, garbage);
        }
        expect(changed).toHaveBeenCalledTimes(1);
        expect(service.state).toEqual(STATE);
    });

    it("подписку можно снять; dispose снимает команду", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        const sub = service.onDidChangeState(changed);
        sub.dispose();
        commands.execute(PUBLISH_REPO_STATE_COMMAND, STATE);
        expect(changed).not.toHaveBeenCalled();

        service.dispose();
        expect(commands.has(PUBLISH_REPO_STATE_COMMAND)).toBe(false);
    });
});
