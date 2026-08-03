import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import { ChangesComponentDIToken } from "./changesComponent.ts";
import { ScmChangesServiceDIToken, type IScmChange, type ScmGroupId } from "./changesService.ts";
import {
    gitStageAction,
    gitStageAllAction,
    gitUnstageAction,
    gitUnstageAllAction,
    resolveScmTargets,
    runGitTransport,
    STAGE_TRANSPORT_COMMAND,
    UNSTAGE_TRANSPORT_COMMAND,
} from "./stagingActions.ts";

function change(rel: string, group: ScmGroupId): IScmChange {
    return {
        uri: Uri.file(`/repo/${rel}`),
        status: "M",
        colorId: "gitDecoration.modifiedResourceForeground",
        path: rel,
        group,
    };
}

function uriOf(rel: string): string {
    return Uri.file(`/repo/${rel}`).toString();
}

interface IHarness {
    accessor: ServiceAccessor;
    executed: [string, unknown[]][];
    notices: string[];
    setChanges(changes: IScmChange[]): void;
    setSelection(changes: IScmChange[]): void;
    setTransport(result: unknown | (() => unknown)): void;
    hasCommand: { value: boolean };
}

function makeHarness(): IHarness {
    let changes: IScmChange[] = [];
    let selection: IScmChange[] = [];
    let transportResult: unknown | (() => unknown) = { ok: true };
    const executed: [string, unknown[]][] = [];
    const notices: string[] = [];
    const hasCommand = { value: true };

    const services = new Map<unknown, unknown>([
        [ScmChangesServiceDIToken, { get changes() { return changes; } }],
        [ChangesComponentDIToken, { getSelectedChanges: () => selection }],
        [
            CommandRegistryDIToken,
            {
                has: () => hasCommand.value,
                execute: (id: string, ...args: unknown[]) => {
                    executed.push([id, args]);
                    return typeof transportResult === "function" ? transportResult() : transportResult;
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
    ]);
    const accessor = {
        get(token: unknown) {
            if (services.has(token)) return services.get(token);
            throw new Error("unexpected token");
        },
    } as unknown as ServiceAccessor;

    return {
        accessor,
        executed,
        notices,
        setChanges: (c) => {
            changes = c;
        },
        setSelection: (s) => {
            selection = s;
        },
        setTransport: (r) => {
            transportResult = r;
        },
        hasCommand,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("resolveScmTargets", () => {
    it("фильтрует явные uri по применимости групп и дедуплицирует MM-файл", () => {
        const h = makeHarness();
        h.setChanges([
            change("mm.ts", "index"),
            change("mm.ts", "worktree"),
            change("staged.ts", "index"),
            change("plain.ts", "worktree"),
        ]);

        const targets = resolveScmTargets(
            h.accessor,
            [uriOf("mm.ts"), uriOf("mm.ts"), uriOf("staged.ts"), uriOf("plain.ts"), uriOf("ghost.ts")],
            ["worktree", "untracked", "merge"],
        );
        // staged.ts только в индексе — для stage неприменим; mm.ts один раз.
        expect(targets.map((u) => u.toString())).toEqual([uriOf("mm.ts"), uriOf("plain.ts")]);
    });

    it("без явных uri берёт выделение списка Changes", () => {
        const h = makeHarness();
        h.setChanges([change("a.ts", "worktree"), change("b.ts", "index")]);
        h.setSelection([change("a.ts", "worktree"), change("b.ts", "index")]);

        const stageable = resolveScmTargets(h.accessor, undefined, ["worktree", "untracked", "merge"]);
        expect(stageable.map((u) => u.toString())).toEqual([uriOf("a.ts")]);

        const unstageable = resolveScmTargets(h.accessor, undefined, ["index"]);
        expect(unstageable.map((u) => u.toString())).toEqual([uriOf("b.ts")]);
    });

    it("не-строковые элементы аргумента → фолбэк на выделение", () => {
        const h = makeHarness();
        h.setChanges([change("a.ts", "worktree")]);
        h.setSelection([change("a.ts", "worktree")]);

        const targets = resolveScmTargets(h.accessor, [42, null], ["worktree"]);
        expect(targets.map((u) => u.toString())).toEqual([uriOf("a.ts")]);
    });
});

describe("runGitTransport", () => {
    it("пустые цели и отсутствующая команда — тихие no-op", async () => {
        const h = makeHarness();
        await runGitTransport(h.accessor, STAGE_TRANSPORT_COMMAND, []);
        expect(h.executed).toEqual([]);

        h.hasCommand.value = false;
        await runGitTransport(h.accessor, STAGE_TRANSPORT_COMMAND, [Uri.file("/repo/a.ts")]);
        expect(h.executed).toEqual([]);
        expect(h.notices).toEqual([]);
    });

    it("успех — без notice; цели уходят строками", async () => {
        const h = makeHarness();
        await runGitTransport(h.accessor, STAGE_TRANSPORT_COMMAND, [Uri.file("/repo/a.ts")]);
        expect(h.executed).toEqual([[STAGE_TRANSPORT_COMMAND, [[uriOf("a.ts")]]]]);
        expect(h.notices).toEqual([]);
    });

    it("ошибка транспорта — транзиентный notice с сообщением git", async () => {
        const h = makeHarness();
        h.setTransport({ ok: false, message: "fatal: pathspec 'x' did not match" });
        await runGitTransport(h.accessor, UNSTAGE_TRANSPORT_COMMAND, [Uri.file("/repo/a.ts")]);
        expect(h.notices).toEqual(["Git: fatal: pathspec 'x' did not match"]);
        vi.runAllTimers(); // dispose таймера notice — не должен бросать
    });

    it("реджект канала и пустое сообщение — generic notice", async () => {
        const h = makeHarness();
        h.setTransport(() => Promise.reject(new Error("channel closed")));
        await runGitTransport(h.accessor, STAGE_TRANSPORT_COMMAND, [Uri.file("/repo/a.ts")]);

        h.setTransport({ ok: false });
        await runGitTransport(h.accessor, STAGE_TRANSPORT_COMMAND, [Uri.file("/repo/a.ts")]);
        expect(h.notices).toEqual(["Git: git failed", "Git: git failed"]);
    });
});

describe("git.stage / git.unstage", () => {
    it("git.stage шлёт применимые цели в vexx.git.stage", async () => {
        const h = makeHarness();
        h.setChanges([change("a.ts", "worktree"), change("s.ts", "index")]);
        await gitStageAction.run(h.accessor, [uriOf("a.ts"), uriOf("s.ts")]);
        expect(h.executed).toEqual([[STAGE_TRANSPORT_COMMAND, [[uriOf("a.ts")]]]]);
    });

    it("git.unstage шлёт только staged-цели в vexx.git.unstage", async () => {
        const h = makeHarness();
        h.setChanges([change("a.ts", "worktree"), change("s.ts", "index")]);
        await gitUnstageAction.run(h.accessor, [uriOf("a.ts"), uriOf("s.ts")]);
        expect(h.executed).toEqual([[UNSTAGE_TRANSPORT_COMMAND, [[uriOf("s.ts")]]]]);
    });

    it("видимость пунктов меню — по группам целей контекста", () => {
        const worktreeCtx = { kind: "resource", uris: [], groups: ["worktree"] };
        const indexCtx = { kind: "resource", uris: [], groups: ["index"] };
        const mixedCtx = { kind: "resource", uris: [], groups: ["index", "worktree"] };

        for (const placement of gitStageAction.menus!) {
            expect(placement.visible?.(worktreeCtx)).toBe(true);
            expect(placement.visible?.(indexCtx)).toBe(false);
            expect(placement.visible?.(mixedCtx)).toBe(true);
            expect(placement.args?.({ kind: "group", uris: ["u"], groups: [] })).toEqual([["u"]]);
        }
        for (const placement of gitUnstageAction.menus!) {
            expect(placement.visible?.(worktreeCtx)).toBe(false);
            expect(placement.visible?.(indexCtx)).toBe(true);
            expect(placement.visible?.(mixedCtx)).toBe(true);
        }
    });
});

describe("git.stageAll / git.unstageAll", () => {
    it("берут все применимые файлы из снимка сервиса", async () => {
        const h = makeHarness();
        h.setChanges([
            change("a.ts", "worktree"),
            change("u.ts", "untracked"),
            change("m.ts", "merge"),
            change("s.ts", "index"),
        ]);

        await gitStageAllAction.run(h.accessor);
        expect(h.executed).toEqual([[STAGE_TRANSPORT_COMMAND, [[uriOf("a.ts"), uriOf("u.ts"), uriOf("m.ts")]]]]);

        h.executed.length = 0;
        await gitUnstageAllAction.run(h.accessor);
        expect(h.executed).toEqual([[UNSTAGE_TRANSPORT_COMMAND, [[uriOf("s.ts")]]]]);
    });

    it("пустой снимок — no-op без вызова транспорта", async () => {
        const h = makeHarness();
        await gitStageAllAction.run(h.accessor);
        await gitUnstageAllAction.run(h.accessor);
        expect(h.executed).toEqual([]);
    });
});
