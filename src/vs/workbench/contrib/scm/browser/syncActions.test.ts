import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressService, ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";

import { ScmRepoStateServiceDIToken } from "./repoStateService.ts";
import {
    gitFetchAction,
    gitFetchAllAction,
    gitFetchPruneAction,
    gitPublishAction,
    gitPullAction,
    gitPullFromAction,
    gitPullRebaseAction,
    gitPushAction,
    gitPushForceAction,
    gitPushToAction,
    gitPushToForceAction,
    gitPushWithTagsAction,
    gitPushWithTagsForceAction,
    gitSyncAction,
    gitSyncRebaseAction,
    pickRemote,
    QUERY_COMMAND,
    queryRefs,
    runGitQuery,
    SYNC_ACTIONS,
} from "./syncActions.ts";

interface IHarness {
    accessor: ServiceAccessor;
    ops: { op: string; params?: Record<string, unknown> }[];
    notices: string[];
    dialogs: string[];
    setRepoState(state: Partial<{ branch: string | null; upstream: string | null; remotes: string[] }>): void;
    setOpResults(results: unknown[]): void;
    setQueryResult(result: unknown): void;
    setPick(label: string | undefined): void;
    confirmAnswer: { value: boolean };
    picks: { title?: string; items: readonly { label: string }[] }[];
    hasCommand: { value: boolean };
}

function makeHarness(): IHarness {
    let repoState = { branch: "main" as string | null, upstream: null as string | null, remotes: ["origin"] };
    let opResults: unknown[] = [{ ok: true }];
    let queryResult: unknown = null;
    let pickResult: string | undefined;
    const ops: { op: string; params?: Record<string, unknown> }[] = [];
    const notices: string[] = [];
    const dialogs: string[] = [];
    const picks: { title?: string; items: readonly { label: string }[] }[] = [];
    const confirmAnswer = { value: true };

    const hasCommand = { value: true };
    const services = new Map<unknown, unknown>([
        // Прогресс операций: транспортные швы просят его у контейнера.
        [ProgressServiceDIToken, new ProgressService()],
        [
            CommandRegistryDIToken,
            {
                has: () => hasCommand.value,
                execute: (id: string, payload: { op?: string; kind?: string; params?: Record<string, unknown> }) => {
                    if (id === GIT_OP_COMMAND) {
                        ops.push({ op: payload.op!, params: payload.params });
                        return opResults.length > 1 ? opResults.shift() : opResults[0];
                    }
                    if (id === QUERY_COMMAND) return queryResult;
                    throw new Error(`unexpected command ${id}`);
                },
            },
        ],
        [
            StatusBarServiceDIToken,
            {
                addEntry: (entry: { text: string }) => {
                    notices.push(entry.text);
                    return { dispose: () => undefined };
                },
            },
        ],
        [
            DialogServiceDIToken,
            {
                confirm: (options: { title: string }) => {
                    dialogs.push(options.title);
                    return Promise.resolve(confirmAnswer.value);
                },
            },
        ],
        [
            QuickInputServiceDIToken,
            {
                quickPick: (opts: { title?: string; items: readonly { label: string }[] }) => {
                    picks.push(opts);
                    return Promise.resolve(pickResult === undefined ? undefined : { label: pickResult });
                },
            },
        ],
        [
            ScmRepoStateServiceDIToken,
            {
                get state() {
                    return { ...repoState, detached: false, ahead: 0, behind: 0, state: "idle" };
                },
            },
        ],
    ]);
    return {
        accessor: {
            get(token: unknown) {
                if (services.has(token)) return services.get(token);
                throw new Error("unexpected token");
            },
        } as unknown as ServiceAccessor,
        ops,
        notices,
        dialogs,
        setRepoState: (s) => {
            repoState = { ...repoState, ...s };
        },
        setOpResults: (r) => {
            opResults = r;
        },
        setQueryResult: (r) => {
            queryResult = r;
        },
        setPick: (label) => {
            pickResult = label;
        },
        confirmAnswer,
        picks,
        hasCommand,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("pull / fetch / sync", () => {
    it("git.pull зовёт op pull; конфликт — понятный notice", async () => {
        const h = makeHarness();
        await gitPullAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "pull", params: undefined }]);

        h.setOpResults([{ ok: false, kind: "conflict", message: "CONFLICT" }]);
        await gitPullAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("Merge Changes"))).toBe(true);
    });

    it("auth-ошибка — диалог с подсказкой про credential helper", async () => {
        const h = makeHarness();
        h.setOpResults([{ ok: false, kind: "auth", message: "terminal prompts disabled" }]);
        await gitFetchAllAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "fetch", params: { all: true } }]);
        expect(h.dialogs).toEqual(["Git: Authentication Failed"]);
    });

    it("git.sync шлёт op sync", async () => {
        const h = makeHarness();
        await gitSyncAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "sync", params: undefined }]);
    });

    it("git.pullFrom: пикер remote-ветки → pull remote+ref", async () => {
        const h = makeHarness();
        h.setQueryResult({
            refs: [
                { name: "origin/main", kind: "remote", sha: "abc", subject: "s" },
                { name: "origin/dev", kind: "remote", sha: "def", subject: "s" },
                { name: "main", kind: "head", sha: "abc", subject: "s" },
            ],
        });
        h.setPick("origin/dev");
        await gitPullFromAction.run(h.accessor);
        // Один remote — пикер remote не показывается, только пикер ветки.
        expect(h.picks).toHaveLength(1);
        expect(h.picks[0].items.map((i) => i.label)).toEqual(["origin/main", "origin/dev"]);
        expect(h.ops).toEqual([{ op: "pull", params: { remote: "origin", ref: "dev" } }]);
    });
});

describe("push и его реакции", () => {
    it("успешный push — одна операция, без диалогов", async () => {
        const h = makeHarness();
        await gitPushAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "push", params: {} }]);
        expect(h.dialogs).toEqual([]);
    });

    it("no-upstream → предложение Publish → push -u в единственный remote", async () => {
        const h = makeHarness();
        h.setOpResults([{ ok: false, kind: "no-upstream", message: "no upstream" }, { ok: true }]);
        await gitPushAction.run(h.accessor);
        expect(h.dialogs).toEqual(["Publish Branch"]);
        expect(h.ops).toEqual([
            { op: "push", params: {} },
            { op: "push", params: { remote: "origin", ref: "main", setUpstream: true } },
        ]);
    });

    it("push-rejected → предложение Pull → op pull", async () => {
        const h = makeHarness();
        h.setOpResults([{ ok: false, kind: "push-rejected", message: "[rejected]" }, { ok: true }]);
        await gitPushAction.run(h.accessor);
        expect(h.dialogs).toEqual(["Push Rejected"]);
        expect(h.ops).toEqual([{ op: "push", params: {} }, { op: "pull", params: undefined }]);
    });

    it("отказ в диалогах rejected/publish — второй операции нет", async () => {
        const h = makeHarness();
        h.confirmAnswer.value = false;
        h.setOpResults([{ ok: false, kind: "push-rejected", message: "[rejected]" }]);
        await gitPushAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "push", params: {} }]);
    });

    it("git.pushForce: confirm → force-with-lease; отказ — no-op", async () => {
        const h = makeHarness();
        await gitPushForceAction.run(h.accessor);
        expect(h.dialogs).toEqual(["Force Push"]);
        expect(h.ops).toEqual([{ op: "push", params: { forceWithLease: true } }]);

        h.ops.length = 0;
        h.confirmAnswer.value = false;
        await gitPushForceAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });

    it("git.pushTo: несколько remotes — пикер; detached — notice", async () => {
        const h = makeHarness();
        h.setRepoState({ remotes: ["origin", "fork"] });
        h.setPick("fork");
        await gitPushToAction.run(h.accessor);
        expect(h.picks).toHaveLength(1);
        expect(h.ops).toEqual([{ op: "push", params: { remote: "fork", ref: "main", forceWithLease: false } }]);

        h.ops.length = 0;
        h.setRepoState({ branch: null });
        await gitPushToAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.notices.some((n) => n.includes("not on a branch"))).toBe(true);
    });

    it("git.publish: без remotes — notice; отмена пикера — no-op", async () => {
        const h = makeHarness();
        h.setRepoState({ remotes: [] });
        await gitPublishAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.notices.some((n) => n.includes("no remotes"))).toBe(true);

        h.setRepoState({ remotes: ["origin", "fork"] });
        h.setPick(undefined);
        await gitPublishAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });
});

describe("хелперы", () => {
    it("pickRemote: один remote — без пикера", async () => {
        const h = makeHarness();
        expect(await pickRemote(h.accessor, "T")).toBe("origin");
        expect(h.picks).toEqual([]);
    });

    it("queryRefs фильтрует мусор и переживает null", async () => {
        const h = makeHarness();
        expect(await queryRefs(h.accessor)).toEqual([]);

        h.setQueryResult({ refs: [{ name: "main", kind: "head", sha: "a", subject: "s" }, { bad: true }, 42] });
        expect(await queryRefs(h.accessor)).toEqual([{ name: "main", kind: "head", sha: "a", subject: "s" }]);
    });

    it("флаговые варианты шлют свои параметры", async () => {
        const h = makeHarness();
        await gitPullRebaseAction.run(h.accessor);
        await gitSyncRebaseAction.run(h.accessor);
        await gitFetchAction.run(h.accessor);
        await gitFetchPruneAction.run(h.accessor);
        await gitPushWithTagsAction.run(h.accessor);
        await gitPushWithTagsForceAction.run(h.accessor);
        await gitPushToForceAction.run(h.accessor); // один remote, confirm=true
        expect(h.ops).toEqual([
            { op: "pull", params: { rebase: true } },
            { op: "sync", params: { rebase: true } },
            { op: "fetch", params: undefined },
            { op: "fetch", params: { prune: true } },
            { op: "push", params: { followTags: true } },
            { op: "push", params: { followTags: true, forceWithLease: true } },
            { op: "push", params: { remote: "origin", ref: "main", forceWithLease: true } },
        ]);
    });

    it("git.publish без ветки (detached) — notice; pullFrom с отменой пикера — no-op", async () => {
        const h = makeHarness();
        h.setRepoState({ branch: null });
        await gitPublishAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("not on a branch"))).toBe(true);

        h.setRepoState({ branch: "main" });
        h.setQueryResult({ refs: [{ name: "origin/dev", kind: "remote", sha: "a", subject: "s" }] });
        h.setPick(undefined);
        await gitPullFromAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });

    it("generic git-error: pull — notice с сообщением, push — той же дорогой", async () => {
        const h = makeHarness();
        h.setOpResults([{ ok: false, kind: "git-error", message: "could not resolve host" }]);
        await gitPullAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("could not resolve host"))).toBe(true);

        h.setOpResults([{ ok: false, kind: "dirty-worktree", message: "would be overwritten" }]);
        await gitPushAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("would be overwritten"))).toBe(true);
    });

    it("runGitQuery без команды расширения и при реджекте канала — null", async () => {
        const h = makeHarness();
        h.hasCommand.value = false;
        expect(await runGitQuery(h.accessor, "refs")).toBeNull();

        h.hasCommand.value = true;
        h.setQueryResult(Promise.reject(new Error("closed")));
        expect(await runGitQuery(h.accessor, "refs")).toBeNull();
    });

    it("отмены пикеров и confirm-ов: pushTo/pushToForce/pullFrom/publish-поток", async () => {
        const h = makeHarness();
        // pushTo: пикер отменён (несколько remotes).
        h.setRepoState({ remotes: ["origin", "fork"] });
        h.setPick(undefined);
        await gitPushToAction.run(h.accessor);
        expect(h.ops).toEqual([]);

        // pushToForce: remote выбран, но force-confirm отклонён.
        h.setPick("fork");
        h.confirmAnswer.value = false;
        await gitPushToForceAction.run(h.accessor);
        expect(h.ops).toEqual([]);

        // pushWithTagsForce: confirm отклонён.
        await gitPushWithTagsForceAction.run(h.accessor);
        expect(h.ops).toEqual([]);

        // no-upstream: предложение Publish отклонено — второй операции нет.
        h.confirmAnswer.value = false;
        h.setOpResults([{ ok: false, kind: "no-upstream", message: "no upstream" }]);
        await gitPushAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "push", params: {} }]);

        // pullFrom при пустых remotes — notice, без пикеров.
        h.ops.length = 0;
        h.setRepoState({ remotes: [] });
        await gitPullFromAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.notices.some((n) => n.includes("no remotes"))).toBe(true);
    });

    it("push при неактивном расширении — тихий no-op", async () => {
        const h = makeHarness();
        h.hasCommand.value = false;
        await gitPushAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.dialogs).toEqual([]);
    });

    it("номенклатура и when-гейты", () => {
        expect(SYNC_ACTIONS.map((a) => a.id)).toEqual([
            "git.pull",
            "git.pullRebase",
            "git.pullFrom",
            "git.push",
            "git.pushForce",
            "git.pushTo",
            "git.pushToForce",
            "git.pushWithTags",
            "git.pushWithTagsForce",
            "git.sync",
            "git.syncRebase",
            "git.fetch",
            "git.fetchPrune",
            "git.fetchAll",
            "git.publish",
        ]);
        expect(gitSyncAction.when).toBe("gitHasRemotes && gitHasUpstream");
        expect(gitPullAction.when).toBe("gitHasRemotes");
    });
});
