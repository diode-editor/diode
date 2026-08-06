import { describe, expect, it } from "vitest";

import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { ClipboardDIToken } from "../../../common/coreTokens.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";

import {
    GRAPH_COMMIT_ACTIONS,
    graphBranchAction,
    graphCheckoutDetachedAction,
    graphCherryPickAction,
    graphCopyCommitIdAction,
    graphCopyCommitMessageAction,
    graphCreateTagAction,
    graphResetAction,
    graphRevertAction,
} from "./graphCommitActions.ts";

const SHA = "a".repeat(40);

interface IHarness {
    accessor: ServiceAccessor;
    ops: { op: string; params?: Record<string, unknown> }[];
    notices: string[];
    dialogs: { title: string; warning?: boolean }[];
    clipboard: string[];
    lastPickItems: { value: readonly { label: string; description?: string }[] };
    setOpResults(results: unknown[]): void;
    setPicks(labels: (string | undefined)[]): void;
    setInputs(values: (string | undefined)[]): void;
    confirmAnswer: { value: boolean };
}

function makeHarness(): IHarness {
    let opResults: unknown[] = [{ ok: true }];
    let pickResults: (string | undefined)[] = [];
    let inputResults: (string | undefined)[] = [];
    const ops: { op: string; params?: Record<string, unknown> }[] = [];
    const notices: string[] = [];
    const dialogs: { title: string; warning?: boolean }[] = [];
    const clipboard: string[] = [];
    const confirmAnswer = { value: true };
    const lastPickItems: { value: readonly { label: string; description?: string }[] } = { value: [] };

    const services = new Map<unknown, unknown>([
        [
            CommandRegistryDIToken,
            {
                has: () => true,
                execute: (id: string, payload: { op?: string; params?: Record<string, unknown> }) => {
                    if (id !== GIT_OP_COMMAND) throw new Error(`unexpected command ${id}`);
                    ops.push({ op: payload.op!, params: payload.params });
                    return opResults.length > 1 ? opResults.shift() : opResults[0];
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
                confirm: (options: { title: string; warning?: boolean }) => {
                    dialogs.push({ title: options.title, warning: options.warning });
                    return Promise.resolve(confirmAnswer.value);
                },
            },
        ],
        [
            QuickInputServiceDIToken,
            {
                quickPick: (opts: { items: readonly { label: string; description?: string }[] }) => {
                    lastPickItems.value = opts.items;
                    const label = pickResults.shift();
                    return Promise.resolve(label === undefined ? undefined : { label });
                },
                input: () => Promise.resolve(inputResults.shift()),
            },
        ],
        [
            ClipboardDIToken,
            {
                writeText: (text: string) => {
                    clipboard.push(text);
                    return Promise.resolve();
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
        clipboard,
        lastPickItems,
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

describe("команды коммита в графе", () => {
    it("Checkout (Detached) чекаутит sha в detached-состоянии", async () => {
        const h = makeHarness();
        await graphCheckoutDetachedAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "checkout", params: { ref: SHA, detach: true } }]);
    });

    it("Create Branch создаёт ветку от коммита", async () => {
        const h = makeHarness();
        h.setInputs(["feature/graph"]);
        await graphBranchAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "branchCreate", params: { name: "feature/graph", base: SHA } }]);
    });

    it("Create Tag ставит тег на выбранный коммит", async () => {
        const h = makeHarness();
        h.setInputs(["v1.0"]);
        await graphCreateTagAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "tagCreate", params: { name: "v1.0", ref: SHA } }]);
    });

    it("отменённый ввод имени операцию не запускает", async () => {
        const h = makeHarness();
        h.setInputs([undefined]);
        await graphCreateTagAction.run(h.accessor, SHA);
        await graphBranchAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([]);
    });

    it("Cherry Pick сообщает о конфликте понятным notice", async () => {
        const h = makeHarness();
        h.setOpResults([{ ok: false, kind: "conflict", message: "raw stderr" }]);
        await graphCherryPickAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "cherryPick", params: { sha: SHA } }]);
        expect(h.notices.join()).toContain("cherry pick resulted in conflicts");
    });

    it("Revert кладёт обратный коммит, прочие ошибки показывает как есть", async () => {
        const h = makeHarness();
        await graphRevertAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "revert", params: { ref: SHA } }]);

        const failing = makeHarness();
        failing.setOpResults([{ ok: false, kind: "git-error", message: "bad object" }]);
        await graphRevertAction.run(failing.accessor, SHA);
        expect(failing.notices.join()).toContain("bad object");
    });

    it("Reset предлагает три режима, mixed идёт без подтверждения", async () => {
        const h = makeHarness();
        h.setPicks(["Mixed"]);
        await graphResetAction.run(h.accessor, SHA);

        expect(h.lastPickItems.value.map((i) => i.label)).toEqual(["Mixed", "Soft", "Hard"]);
        expect(h.ops).toEqual([{ op: "reset", params: { ref: SHA, mode: "mixed" } }]);
        expect(h.dialogs).toEqual([]);
    });

    it("Reset soft тоже без подтверждения — правки не теряются", async () => {
        const h = makeHarness();
        h.setPicks(["Soft"]);
        await graphResetAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "reset", params: { ref: SHA, mode: "soft" } }]);
        expect(h.dialogs).toEqual([]);
    });

    it("Reset hard требует подтверждения; отказ отменяет операцию", async () => {
        const h = makeHarness();
        h.setPicks(["Hard"]);
        h.confirmAnswer.value = false;
        await graphResetAction.run(h.accessor, SHA);
        expect(h.dialogs).toEqual([{ title: "Reset to Commit", warning: true }]);
        expect(h.ops).toEqual([]);

        const confirmed = makeHarness();
        confirmed.setPicks(["Hard"]);
        await graphResetAction.run(confirmed.accessor, SHA);
        expect(confirmed.ops).toEqual([{ op: "reset", params: { ref: SHA, mode: "hard" } }]);
    });

    it("отменённый пикер режима ничего не делает", async () => {
        const h = makeHarness();
        h.setPicks([undefined]);
        await graphResetAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([]);
        expect(h.dialogs).toEqual([]);
    });

    it("Copy Commit ID и Copy Commit Message кладут значения в буфер", async () => {
        const h = makeHarness();
        await graphCopyCommitIdAction.run(h.accessor, SHA);
        await graphCopyCommitMessageAction.run(h.accessor, "feat: панель");
        expect(h.clipboard).toEqual([SHA, "feat: панель"]);
    });

    it("без аргумента (вызов из палитры) команды выходят тихо", async () => {
        const h = makeHarness();
        for (const action of GRAPH_COMMIT_ACTIONS) {
            await action.run(h.accessor, undefined);
            await action.run(h.accessor, "");
        }
        expect(h.ops).toEqual([]);
        expect(h.clipboard).toEqual([]);
        expect(h.dialogs).toEqual([]);
    });

    it("все команды графа сидят в меню коммита и передают ему аргумент", () => {
        for (const action of GRAPH_COMMIT_ACTIONS) {
            expect(action.menus, action.id).toHaveLength(1);
            expect(action.menus![0].args, action.id).toBeDefined();
        }
    });
});
