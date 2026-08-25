import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressService, ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";

import { QUERY_COMMAND } from "./syncActions.ts";
import {
    gitStashAction,
    gitStashApplyAction,
    gitStashApplyLatestAction,
    gitStashDropAction,
    gitStashDropAllAction,
    gitStashIncludeUntrackedAction,
    gitStashPopAction,
    gitStashPopLatestAction,
    gitStashStagedAction,
    queryStashes,
    STASH_ACTIONS,
} from "./stashActions.ts";

interface IHarness {
    accessor: ServiceAccessor;
    ops: { op: string; params?: Record<string, unknown> }[];
    notices: string[];
    dialogs: string[];
    setStashes(stashes: { index: string; description?: string }[] | null): void;
    setOpResults(results: unknown[]): void;
    setPicks(labels: (string | undefined)[]): void;
    setInputs(values: (string | undefined)[]): void;
    confirmAnswer: { value: boolean };
}

function makeHarness(): IHarness {
    let stashes: { index: string; description?: string }[] | null = [];
    let opResults: unknown[] = [{ ok: true }];
    let pickResults: (string | undefined)[] = [];
    let inputResults: (string | undefined)[] = [];
    const ops: { op: string; params?: Record<string, unknown> }[] = [];
    const notices: string[] = [];
    const dialogs: string[] = [];
    const confirmAnswer = { value: true };

    const services = new Map<unknown, unknown>([
        // Прогресс операций: транспортные швы просят его у контейнера.
        [ProgressServiceDIToken, new ProgressService()],
        [
            CommandRegistryDIToken,
            {
                has: () => true,
                execute: (id: string, payload: { op?: string; params?: Record<string, unknown> }) => {
                    if (id === GIT_OP_COMMAND) {
                        ops.push({ op: payload.op!, params: payload.params });
                        return opResults.length > 1 ? opResults.shift() : opResults[0];
                    }
                    if (id === QUERY_COMMAND) return stashes === null ? null : { stashes };
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
                quickPick: () => {
                    const label = pickResults.shift();
                    return Promise.resolve(label === undefined ? undefined : { label });
                },
                input: () => Promise.resolve(inputResults.shift()),
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
        setStashes: (s) => {
            stashes = s;
        },
        setOpResults: (r) => {
            opResults = r;
        },
        setPicks: (labels) => {
            pickResults = labels;
        },
        setInputs: (values) => {
            inputResults = values;
        },
        confirmAnswer,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("stash push-семейство", () => {
    it("git.stash: сообщение опционально, Escape отменяет", async () => {
        const h = makeHarness();
        h.setInputs(["wip work"]);
        await gitStashAction.run(h.accessor);
        expect(h.ops).toEqual([
            { op: "stashPush", params: { message: "wip work", includeUntracked: false, staged: false } },
        ]);

        h.ops.length = 0;
        h.setInputs([""]);
        await gitStashAction.run(h.accessor);
        expect(h.ops[0].params?.message).toBe("");

        h.ops.length = 0;
        h.setInputs([undefined]); // Escape
        await gitStashAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });

    it("includeUntracked и staged пробрасывают флаги", async () => {
        const h = makeHarness();
        h.setInputs(["", ""]);
        await gitStashIncludeUntrackedAction.run(h.accessor);
        await gitStashStagedAction.run(h.accessor);
        expect(h.ops[0].params?.includeUntracked).toBe(true);
        expect(h.ops[1].params?.staged).toBe(true);
    });
});

describe("pop / apply", () => {
    it("latest-варианты идут без индекса", async () => {
        const h = makeHarness();
        await gitStashPopLatestAction.run(h.accessor);
        await gitStashApplyLatestAction.run(h.accessor);
        expect(h.ops).toEqual([
            { op: "stashPop", params: undefined },
            { op: "stashApply", params: undefined },
        ]);
    });

    it("пикерные варианты передают выбранный индекс; пустой список — notice", async () => {
        const h = makeHarness();
        h.setStashes([{ index: "stash@{0}", description: "WIP" }]);
        h.setPicks(["stash@{0}", "stash@{0}"]);
        await gitStashPopAction.run(h.accessor);
        await gitStashApplyAction.run(h.accessor);
        expect(h.ops).toEqual([
            { op: "stashPop", params: { index: "stash@{0}" } },
            { op: "stashApply", params: { index: "stash@{0}" } },
        ]);

        h.ops.length = 0;
        h.setStashes([]);
        await gitStashPopAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.notices.some((n) => n.includes("no stashes"))).toBe(true);
    });

    it("конфликт при pop — notice, что стэш сохранён", async () => {
        const h = makeHarness();
        h.setOpResults([{ ok: false, kind: "conflict", message: "CONFLICT" }]);
        await gitStashPopLatestAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("stash entry is kept"))).toBe(true);

        h.setOpResults([{ ok: false, kind: "git-error", message: "no stash entries" }]);
        await gitStashPopLatestAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("no stash entries"))).toBe(true);
    });
});

describe("drop", () => {
    it("git.stashDrop: пикер + confirm; отказ — no-op", async () => {
        const h = makeHarness();
        h.setStashes([{ index: "stash@{1}", description: "old" }]);
        h.setPicks(["stash@{1}"]);
        await gitStashDropAction.run(h.accessor);
        expect(h.dialogs).toEqual(["Drop Stash"]);
        expect(h.ops).toEqual([{ op: "stashDrop", params: { index: "stash@{1}" } }]);

        h.ops.length = 0;
        h.setPicks(["stash@{1}"]);
        h.confirmAnswer.value = false;
        await gitStashDropAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });

    it("git.stashDropAll: confirm с количеством → stash clear; пустой список — notice", async () => {
        const h = makeHarness();
        h.setStashes([{ index: "stash@{0}" }, { index: "stash@{1}" }]);
        await gitStashDropAllAction.run(h.accessor);
        expect(h.dialogs).toEqual(["Drop All Stashes"]);
        expect(h.ops).toEqual([{ op: "stashClear", params: undefined }]);

        h.ops.length = 0;
        h.setStashes([]);
        await gitStashDropAllAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.notices.some((n) => n.includes("no stashes"))).toBe(true);
    });
});

describe("хелперы и номенклатура", () => {
    it("queryStashes фильтрует мусор и переживает null", async () => {
        const h = makeHarness();
        h.setStashes(null);
        expect(await queryStashes(h.accessor)).toEqual([]);

        h.setStashes([{ index: "stash@{0}", description: "ok" }, { junk: true } as never, 42 as never]);
        expect(await queryStashes(h.accessor)).toEqual([{ index: "stash@{0}", description: "ok" }]);
    });

    it("добивка отмен: пикер отменён (pop/apply/drop), один стэш в dropAll, dropAll отклонён", async () => {
        const h = makeHarness();
        h.setStashes([{ index: "stash@{0}", description: "one" }]);
        h.setPicks([undefined]); // Escape в пикере
        await gitStashApplyAction.run(h.accessor);
        h.setPicks([undefined]);
        await gitStashDropAction.run(h.accessor);
        expect(h.ops).toEqual([]);

        // Единственное число в тексте dropAll + отклонённый confirm.
        h.confirmAnswer.value = false;
        await gitStashDropAllAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.dialogs).toContain("Drop All Stashes");
    });

    it("id в номенклатуре VS Code", () => {
        expect(STASH_ACTIONS.map((a) => a.id)).toEqual([
            "git.stash",
            "git.stashIncludeUntracked",
            "git.stashStaged",
            "git.stashApplyLatest",
            "git.stashApply",
            "git.stashPopLatest",
            "git.stashPop",
            "git.stashDrop",
            "git.stashDropAll",
        ]);
    });
});
