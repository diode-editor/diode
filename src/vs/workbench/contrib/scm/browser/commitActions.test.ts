import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";

import { ScmChangesServiceDIToken, type ScmGroupId } from "./changesService.ts";
import { ScmInputComponentDIToken } from "./scmInputComponent.ts";
import {
    COMMIT_ACTIONS,
    gitCommitAction,
    gitCommitAllAction,
    gitCommitAmendAction,
    gitCommitStagedAction,
    gitUndoCommitAction,
} from "./commitActions.ts";

interface IHarness {
    accessor: ServiceAccessor;
    ops: { op: string; params?: Record<string, unknown> }[];
    notices: string[];
    confirms: number;
    message: { value: string };
    setChanges(groups: ScmGroupId[]): void;
    setOpResult(result: unknown): void;
    confirmAnswer: { value: boolean };
    hasCommand: { value: boolean };
}

function makeHarness(): IHarness {
    let changeGroups: ScmGroupId[] = [];
    let opResult: unknown = { ok: true };
    const ops: { op: string; params?: Record<string, unknown> }[] = [];
    const notices: string[] = [];
    const message = { value: "" };
    const confirmAnswer = { value: true };
    const hasCommand = { value: true };
    const harness = { confirms: 0 };

    const services = new Map<unknown, unknown>([
        [
            ScmInputComponentDIToken,
            {
                get message() {
                    return message.value;
                },
                setMessage: (v: string) => {
                    message.value = v;
                },
            },
        ],
        [
            ScmChangesServiceDIToken,
            {
                get changes() {
                    return changeGroups.map((group, i) => ({ group, path: `f${i}` }));
                },
            },
        ],
        [
            DialogServiceDIToken,
            {
                confirm: () => {
                    harness.confirms++;
                    return Promise.resolve(confirmAnswer.value);
                },
            },
        ],
        [
            CommandRegistryDIToken,
            {
                has: () => hasCommand.value,
                execute: (_id: string, payload: { op: string; params?: Record<string, unknown> }) => {
                    ops.push(payload);
                    return opResult;
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
        ops,
        notices,
        get confirms() {
            return harness.confirms;
        },
        message,
        setChanges: (groups) => {
            changeGroups = groups;
        },
        setOpResult: (r) => {
            opResult = r;
        },
        confirmAnswer,
        hasCommand,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("git.commit (smart)", () => {
    it("staged есть — коммитит индекс и очищает input", async () => {
        const h = makeHarness();
        h.message.value = "feat: msg";
        h.setChanges(["index", "worktree"]);

        await gitCommitAction.run(h.accessor);

        expect(h.ops).toEqual([
            { op: "commit", params: { message: "feat: msg", amend: false, all: false, noVerify: false, allowEmpty: false } },
        ]);
        expect(h.message.value).toBe("");
        expect(h.confirms).toBe(0);
    });

    it("индекс пуст, tracked есть — вопрос; подтверждение коммитит всё", async () => {
        const h = makeHarness();
        h.message.value = "msg";
        h.setChanges(["worktree"]);

        await gitCommitAction.run(h.accessor);
        expect(h.confirms).toBe(1);
        expect(h.ops[0].params?.all).toBe(true);
    });

    it("индекс пуст, отказ в диалоге — коммита нет", async () => {
        const h = makeHarness();
        h.message.value = "msg";
        h.setChanges(["worktree"]);
        h.confirmAnswer.value = false;

        await gitCommitAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.message.value).toBe("msg");
    });

    it("нечего коммитить (только untracked) — notice без диалога", async () => {
        const h = makeHarness();
        h.message.value = "msg";
        h.setChanges(["untracked"]);

        await gitCommitAction.run(h.accessor);
        expect(h.confirms).toBe(0);
        expect(h.ops).toEqual([]);
        expect(h.notices.some((n) => n.includes("no changes"))).toBe(true);
    });

    it("пустое сообщение — notice, op не зовётся", async () => {
        const h = makeHarness();
        h.setChanges(["index"]);

        await gitCommitAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.notices.some((n) => n.includes("commit message is empty"))).toBe(true);
    });

    it("ошибка op — сообщение остаётся в input", async () => {
        const h = makeHarness();
        h.message.value = "msg";
        h.setChanges(["index"]);
        h.setOpResult({ ok: false, kind: "git-error", message: "hook failed" });

        await gitCommitAction.run(h.accessor);
        expect(h.message.value).toBe("msg");
        expect(h.notices.some((n) => n.includes("hook failed"))).toBe(true);
    });

    it("расширение не активно — тихий no-op, сообщение остаётся", async () => {
        const h = makeHarness();
        h.message.value = "msg";
        h.setChanges(["index"]);
        h.hasCommand.value = false;

        await gitCommitAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.message.value).toBe("msg");
    });
});

describe("варианты commit-семейства", () => {
    it("commitStaged не задаёт smart/all; commitAll шлёт all", async () => {
        const h = makeHarness();
        h.message.value = "msg";
        h.setChanges([]); // smart-ветка не должна включиться

        await gitCommitStagedAction.run(h.accessor);
        expect(h.ops[0].params?.all).toBe(false);

        h.message.value = "msg"; // успех первого коммита очистил input
        await gitCommitAllAction.run(h.accessor);
        expect(h.ops[1].params?.all).toBe(true);
        expect(h.confirms).toBe(0);
    });

    it("amend с пустым сообщением допустим (--no-edit на стороне расширения)", async () => {
        const h = makeHarness();
        h.setChanges(["index"]);

        await gitCommitAmendAction.run(h.accessor);
        expect(h.ops).toEqual([
            { op: "commit", params: { message: "", amend: true, all: false, noVerify: false, allowEmpty: false } },
        ]);
    });

    it("вся номенклатура зарегистрирована с id в стиле VS Code", () => {
        expect(COMMIT_ACTIONS.map((a) => a.id)).toEqual([
            "git.commit",
            "git.commitStaged",
            "git.commitAll",
            "git.commitAmend",
            "git.commitStagedAmend",
            "git.commitAllAmend",
            "git.commitNoVerify",
            "git.commitStagedNoVerify",
            "git.commitAllNoVerify",
            "git.commitEmpty",
            "git.undoCommit",
        ]);
    });
});

describe("git.undoCommit", () => {
    it("успех возвращает сообщение в input box", async () => {
        const h = makeHarness();
        h.setOpResult({ ok: true, data: { message: "feat: undone" } });

        await gitUndoCommitAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "undoCommit", params: undefined }]);
        expect(h.message.value).toBe("feat: undone");
    });

    it("ошибка (merge/корневой коммит) — notice, input не трогается", async () => {
        const h = makeHarness();
        h.message.value = "draft";
        h.setOpResult({ ok: false, kind: "git-error", message: "cannot undo a merge commit" });

        await gitUndoCommitAction.run(h.accessor);
        expect(h.message.value).toBe("draft");
        expect(h.notices.some((n) => n.includes("merge commit"))).toBe(true);
    });

    it("успех без сообщения в data — input не трогается", async () => {
        const h = makeHarness();
        h.message.value = "draft";
        h.setOpResult({ ok: true });

        await gitUndoCommitAction.run(h.accessor);
        expect(h.message.value).toBe("draft");
    });
});
