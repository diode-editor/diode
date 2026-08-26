import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressService, ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";

import { ScmRepoStateServiceDIToken } from "./repoStateService.ts";
import { QUERY_COMMAND } from "./syncActions.ts";
import {
    BRANCH_ACTIONS,
    CHECKOUT_DETACHED_LABEL,
    CREATE_BRANCH_FROM_LABEL,
    CREATE_BRANCH_LABEL,
    gitBranchAction,
    gitBranchFromAction,
    gitCheckoutAction,
    gitCheckoutDetachedAction,
    gitCherryPickAction,
    gitDeleteBranchAction,
    gitDeleteRemoteBranchAction,
    gitMergeAbortAction,
    gitMergeAction,
    gitRebaseAbortAction,
    gitRebaseAction,
    gitRenameBranchAction,
} from "./branchActions.ts";

interface IHarness {
    accessor: ServiceAccessor;
    ops: { op: string; params?: Record<string, unknown> }[];
    notices: string[];
    dialogs: string[];
    setRefs(refs: { name: string; kind: string; sha?: string; subject?: string }[]): void;
    setOpResults(results: unknown[]): void;
    setPicks(labels: (string | undefined)[]): void;
    setInputs(values: (string | undefined)[]): void;
    setBranch(branch: string | null): void;
    confirmAnswer: { value: boolean };
    lastPickItems: { value: readonly { label: string; description?: string }[] };
    lastInputValidate: { value: ((v: string) => string | null) | undefined };
}

function makeHarness(): IHarness {
    let refs: { name: string; kind: string; sha?: string; subject?: string }[] = [];
    let opResults: unknown[] = [{ ok: true }];
    let pickResults: (string | undefined)[] = [];
    let inputResults: (string | undefined)[] = [];
    let branch: string | null = "main";
    const ops: { op: string; params?: Record<string, unknown> }[] = [];
    const notices: string[] = [];
    const dialogs: string[] = [];
    const confirmAnswer = { value: true };
    const lastPickItems: { value: readonly { label: string; description?: string }[] } = { value: [] };
    const lastInputValidate: { value: ((v: string) => string | null) | undefined } = { value: undefined };

    const services = new Map<unknown, unknown>([
        // Прогресс операций: транспортные швы просят его у контейнера.
        [ProgressServiceDIToken, new ProgressService()],
        [
            CommandRegistryDIToken,
            {
                has: () => true,
                execute: (id: string, payload: { op?: string; kind?: string; params?: Record<string, unknown> }) => {
                    if (id === GIT_OP_COMMAND) {
                        ops.push({ op: payload.op!, params: payload.params });
                        return opResults.length > 1 ? opResults.shift() : opResults[0];
                    }
                    if (id === QUERY_COMMAND) return { refs: refs.map((r) => ({ sha: "a", subject: "s", ...r })) };
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
                quickPick: (opts: { items: readonly { label: string }[] }) => {
                    lastPickItems.value = opts.items;
                    const label = pickResults.shift();
                    return Promise.resolve(label === undefined ? undefined : { label });
                },
                input: (opts: { validateInput?: (v: string) => string | null }) => {
                    lastInputValidate.value = opts.validateInput;
                    return Promise.resolve(inputResults.shift());
                },
            },
        ],
        [
            ScmRepoStateServiceDIToken,
            {
                get state() {
                    return {
                        branch,
                        detached: false,
                        upstream: null,
                        ahead: 0,
                        behind: 0,
                        remotes: ["origin"],
                        state: "idle",
                    };
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
        setRefs: (r) => {
            refs = r;
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
        setBranch: (b) => {
            branch = b;
        },
        confirmAnswer,
        lastPickItems,
        lastInputValidate,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("git.checkout", () => {
    it("локальная ветка — checkout по имени; remote — DWIM коротким именем", async () => {
        const h = makeHarness();
        h.setRefs([
            { name: "dev", kind: "head" },
            { name: "origin/feature", kind: "remote" },
        ]);
        h.setPicks(["dev"]);
        await gitCheckoutAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "checkout", params: { ref: "dev" } }]);

        h.ops.length = 0;
        h.setPicks(["origin/feature"]);
        await gitCheckoutAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "checkout", params: { ref: "feature" } }]);
    });

    it("спец-пункты: create / create-from / detached", async () => {
        const h = makeHarness();
        h.setRefs([{ name: "main", kind: "head" }]);

        h.setPicks([CREATE_BRANCH_LABEL]);
        h.setInputs(["feat-x"]);
        await gitCheckoutAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "branchCreate", params: { name: "feat-x" } }]);

        h.ops.length = 0;
        h.setPicks([CREATE_BRANCH_FROM_LABEL, "main"]);
        h.setInputs(["feat-y"]);
        await gitCheckoutAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "branchCreate", params: { name: "feat-y", base: "main" } }]);

        h.ops.length = 0;
        h.setPicks([CHECKOUT_DETACHED_LABEL, "main"]);
        await gitCheckoutAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "checkout", params: { ref: "main", detach: true } }]);
    });

    it("отмена пикера и отмена ввода имени — no-op", async () => {
        const h = makeHarness();
        h.setRefs([{ name: "main", kind: "head" }]);
        h.setPicks([undefined]);
        await gitCheckoutAction.run(h.accessor);

        h.setPicks([CREATE_BRANCH_LABEL]);
        h.setInputs([undefined]);
        await gitCheckoutAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });
});

describe("branch-операции", () => {
    it("git.branch: ввод имени → branchCreate; rename с prefill текущей", async () => {
        const h = makeHarness();
        h.setInputs(["new-branch"]);
        await gitBranchAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "branchCreate", params: { name: "new-branch" } }]);

        h.ops.length = 0;
        h.setInputs(["renamed"]);
        await gitRenameBranchAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "branchRename", params: { name: "renamed" } }]);

        // То же имя — no-op.
        h.ops.length = 0;
        h.setInputs(["main"]);
        await gitRenameBranchAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });

    it("git.deleteBranch: текущая ветка не в списке; not-merged → confirm → force", async () => {
        const h = makeHarness();
        h.setRefs([
            { name: "main", kind: "head" },
            { name: "feat", kind: "head" },
        ]);
        h.setPicks(["feat"]);
        h.setOpResults([{ ok: false, kind: "not-merged", message: "not fully merged" }, { ok: true }]);
        await gitDeleteBranchAction.run(h.accessor);

        expect(h.dialogs).toEqual(["Delete Branch"]);
        expect(h.ops).toEqual([
            { op: "branchDelete", params: { name: "feat" } },
            { op: "branchDelete", params: { name: "feat", force: true } },
        ]);
    });

    it("git.deleteBranch: отказ от force и отсутствие других веток", async () => {
        const h = makeHarness();
        h.setRefs([
            { name: "main", kind: "head" },
            { name: "feat", kind: "head" },
        ]);
        h.setPicks(["feat"]);
        h.confirmAnswer.value = false;
        h.setOpResults([{ ok: false, kind: "not-merged", message: "not fully merged" }]);
        await gitDeleteBranchAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "branchDelete", params: { name: "feat" } }]);

        h.ops.length = 0;
        h.setRefs([{ name: "main", kind: "head" }]);
        await gitDeleteBranchAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.notices.some((n) => n.includes("no other local branches"))).toBe(true);
    });

    it("git.deleteRemoteBranch: пикер remote-веток → pushDelete", async () => {
        const h = makeHarness();
        h.setRefs([{ name: "origin/feat", kind: "remote" }]);
        h.setPicks(["origin/feat"]);
        await gitDeleteRemoteBranchAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "pushDelete", params: { remote: "origin", ref: "feat" } }]);
    });

    it("merge: конфликт — notice про Merge Changes; mergeAbort — прямая операция", async () => {
        const h = makeHarness();
        h.setRefs([{ name: "feat", kind: "head" }]);
        h.setPicks(["feat"]);
        h.setOpResults([{ ok: false, kind: "conflict", message: "CONFLICT" }]);
        await gitMergeAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "merge", params: { ref: "feat" } }]);
        expect(h.notices.some((n) => n.includes("Merge Changes"))).toBe(true);

        h.ops.length = 0;
        await gitMergeAbortAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "mergeAbort", params: undefined }]);
    });

    it("rebase: обычная ошибка — notice с сообщением", async () => {
        const h = makeHarness();
        h.setRefs([{ name: "main", kind: "head" }]);
        h.setPicks(["main"]);
        h.setOpResults([{ ok: false, kind: "git-error", message: "cannot rebase" }]);
        await gitRebaseAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("cannot rebase"))).toBe(true);
    });

    it("cherryPick: ввод sha; отмена — no-op", async () => {
        const h = makeHarness();
        h.setInputs(["abc123"]);
        await gitCherryPickAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "cherryPick", params: { sha: "abc123" } }]);

        h.ops.length = 0;
        h.setInputs([undefined]);
        await gitCherryPickAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });

    it("checkoutDetached: пустые refs — notice; бесхозный label пикера — no-op; happy path", async () => {
        const h = makeHarness();
        h.setRefs([]);
        await gitCheckoutDetachedAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("no refs"))).toBe(true);
        expect(h.ops).toEqual([]);

        h.setRefs([{ name: "v1.0", kind: "tag" }]);
        h.setPicks(["ghost"]); // label вне списка (защитная ветка find)
        await gitCheckoutDetachedAction.run(h.accessor);
        expect(h.ops).toEqual([]);

        h.setPicks(["v1.0"]);
        await gitCheckoutDetachedAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "checkout", params: { ref: "v1.0", detach: true } }]);
    });

    it("checkout: тег в пикере помечен, пикер-«призрак» — no-op; валидатор имени ветки", async () => {
        const h = makeHarness();
        h.setRefs([
            { name: "main", kind: "head" },
            { name: "origin/dev", kind: "remote" },
            { name: "v1.0", kind: "tag" },
        ]);
        h.setPicks(["ghost-entry"]);
        await gitCheckoutAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        const descriptions = h.lastPickItems.value.map((i) => i.description ?? "");
        expect(descriptions.some((d) => d.startsWith("tag · "))).toBe(true);
        expect(descriptions.some((d) => d.startsWith("remote · "))).toBe(true);

        // Валидатор ввода имени: пустое — ошибка, непустое — ок.
        h.setPicks([CREATE_BRANCH_LABEL]);
        h.setInputs(["x"]);
        await gitCheckoutAction.run(h.accessor);
        expect(h.lastInputValidate.value?.(" ")).toBe("Branch name is empty");
        expect(h.lastInputValidate.value?.("ok")).toBeNull();
    });

    it("branchFrom: happy path и отмена базового пикера", async () => {
        const h = makeHarness();
        h.setRefs([{ name: "main", kind: "head" }]);
        h.setPicks(["main"]);
        h.setInputs(["feat-z"]);
        await gitBranchFromAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "branchCreate", params: { name: "feat-z", base: "main" } }]);

        h.ops.length = 0;
        h.setPicks([undefined]);
        await gitBranchFromAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });

    it("deleteBranch: отмена пикера, успех без диалога, generic-ошибка — notice", async () => {
        const h = makeHarness();
        h.setRefs([
            { name: "main", kind: "head" },
            { name: "feat", kind: "head" },
        ]);
        h.setPicks([undefined]);
        await gitDeleteBranchAction.run(h.accessor);
        expect(h.ops).toEqual([]);

        h.setPicks(["feat"]);
        await gitDeleteBranchAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "branchDelete", params: { name: "feat" } }]);
        expect(h.dialogs).toEqual([]);

        h.ops.length = 0;
        h.setPicks(["feat"]);
        h.setOpResults([{ ok: false, kind: "git-error", message: "cannot delete" }]);
        await gitDeleteBranchAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("cannot delete"))).toBe(true);
    });

    it("deleteRemoteBranch без remote-веток — notice; merge: отмена и успех", async () => {
        const h = makeHarness();
        h.setRefs([{ name: "main", kind: "head" }]);
        await gitDeleteRemoteBranchAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("no refs"))).toBe(true);

        h.setPicks([undefined]);
        await gitMergeAction.run(h.accessor);
        expect(h.ops).toEqual([]);

        h.setPicks(["main"]);
        h.setOpResults([{ ok: true }]);
        await gitMergeAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "merge", params: { ref: "main" } }]);
    });

    it("rebase: конфликт — notice про Merge Changes; успех — тихо; rebaseAbort", async () => {
        const h = makeHarness();
        h.setRefs([{ name: "main", kind: "head" }]);
        h.setPicks(["main"]);
        h.setOpResults([{ ok: false, kind: "conflict", message: "CONFLICT" }]);
        await gitRebaseAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("rebase resulted in conflicts"))).toBe(true);

        h.ops.length = 0;
        h.setPicks(["main"]);
        h.setOpResults([{ ok: true }]);
        await gitRebaseAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "rebase", params: { ref: "main" } }]);

        h.ops.length = 0;
        await gitRebaseAbortAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "rebaseAbort", params: undefined }]);
    });

    it("cherryPick: пробельный ввод — no-op; валидатор", async () => {
        const h = makeHarness();
        h.setInputs(["   "]);
        await gitCherryPickAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.lastInputValidate.value?.("")).toBe("Commit hash is empty");
        expect(h.lastInputValidate.value?.("abc")).toBeNull();
    });

    it("добивка отмен: спец-пункты checkout с отменённым вторым пикером, rename на detached, rebase-отмена, merge-ошибка", async () => {
        const h = makeHarness();
        h.setRefs([{ name: "main", kind: "head" }]);

        // Спец-пункты: второй пикер отменён — операций нет.
        h.setPicks([CREATE_BRANCH_FROM_LABEL, undefined]);
        await gitCheckoutAction.run(h.accessor);
        h.setPicks([CHECKOUT_DETACHED_LABEL, undefined]);
        await gitCheckoutAction.run(h.accessor);
        expect(h.ops).toEqual([]);

        // Rename при detached (branch null): prefill пустой, ввод работает.
        h.setBranch(null);
        h.setInputs(["from-detached"]);
        await gitRenameBranchAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "branchRename", params: { name: "from-detached" } }]);

        // Rebase: отмена пикера.
        h.ops.length = 0;
        h.setPicks([undefined]);
        await gitRebaseAction.run(h.accessor);
        expect(h.ops).toEqual([]);

        // Merge: не-конфликтная ошибка — notice с сообщением git.
        h.setPicks(["main"]);
        h.setOpResults([{ ok: false, kind: "git-error", message: "merge refused" }]);
        await gitMergeAction.run(h.accessor);
        expect(h.notices.some((n) => n.includes("merge refused"))).toBe(true);
    });

    it("номенклатура и when-гейты abort-команд", () => {
        expect(BRANCH_ACTIONS.map((a) => a.id)).toEqual([
            "git.checkout",
            "git.checkoutDetached",
            "git.branch",
            "git.branchFrom",
            "git.renameBranch",
            "git.deleteBranch",
            "git.deleteRemoteBranch",
            "git.merge",
            "git.mergeAbort",
            "git.rebase",
            "git.rebaseAbort",
            "git.cherryPick",
        ]);
        expect(gitMergeAbortAction.when).toBe("gitMerging");
        expect(gitMergeAction.when).toBe("gitHasRepo && !gitMerging");
    });
});
