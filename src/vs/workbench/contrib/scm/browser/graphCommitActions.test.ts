import { describe, expect, it } from "vitest";

import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressService, ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { ScmGraphMenuContext } from "../../../browser/actions/menuContexts.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
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
        [ProgressServiceDIToken, new ProgressService()],
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

describe("commit commands in the graph", () => {
    it("Checkout (Detached) checks out the sha in detached state", async () => {
        const h = makeHarness();
        await graphCheckoutDetachedAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "checkout", params: { ref: SHA, detach: true } }]);
    });

    it("Create Branch creates a branch from the commit", async () => {
        const h = makeHarness();
        h.setInputs(["feature/graph"]);
        await graphBranchAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "branchCreate", params: { name: "feature/graph", base: SHA } }]);
    });

    it("Create Tag puts a tag on the selected commit", async () => {
        const h = makeHarness();
        h.setInputs(["v1.0"]);
        await graphCreateTagAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "tagCreate", params: { name: "v1.0", ref: SHA } }]);
    });

    it("a cancelled name input does not run the operation", async () => {
        const h = makeHarness();
        h.setInputs([undefined]);
        await graphCreateTagAction.run(h.accessor, SHA);
        await graphBranchAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([]);
    });

    it("Cherry Pick reports a conflict with a clear notice", async () => {
        const h = makeHarness();
        h.setOpResults([{ ok: false, kind: "conflict", message: "raw stderr" }]);
        await graphCherryPickAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "cherryPick", params: { sha: SHA } }]);
        expect(h.notices.join()).toContain("cherry pick resulted in conflicts");
    });

    it("Cherry Pick: other errors are shown as is, success is silent", async () => {
        const failing = makeHarness();
        failing.setOpResults([{ ok: false, kind: "git-error", message: "bad object" }]);
        await graphCherryPickAction.run(failing.accessor, SHA);
        expect(failing.notices.join()).toContain("bad object");

        const ok = makeHarness();
        await graphCherryPickAction.run(ok.accessor, SHA);
        expect(ok.notices).toEqual([]);
    });

    it("Revert adds an inverse commit; conflict and other errors give different notices", async () => {
        const h = makeHarness();
        await graphRevertAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "revert", params: { ref: SHA } }]);
        expect(h.notices).toEqual([]);

        const conflicting = makeHarness();
        conflicting.setOpResults([{ ok: false, kind: "conflict", message: "raw stderr" }]);
        await graphRevertAction.run(conflicting.accessor, SHA);
        expect(conflicting.notices.join()).toContain("revert resulted in conflicts");

        const failing = makeHarness();
        failing.setOpResults([{ ok: false, kind: "git-error", message: "bad object" }]);
        await graphRevertAction.run(failing.accessor, SHA);
        expect(failing.notices.join()).toContain("bad object");
    });

    it("without the git extension operations are silent: there is nothing to notify about", async () => {
        // `runGitOp` returns null when there is no bridge; the caller must not fail.
        const h = makeHarness();
        h.setOpResults([null]);
        await graphCherryPickAction.run(h.accessor, SHA);
        await graphRevertAction.run(h.accessor, SHA);
        expect(h.notices).toEqual([]);
    });

    it("Reset offers three modes, mixed runs without confirmation", async () => {
        const h = makeHarness();
        h.setPicks(["Mixed"]);
        await graphResetAction.run(h.accessor, SHA);

        expect(h.lastPickItems.value.map((i) => i.label)).toEqual(["Mixed", "Soft", "Hard"]);
        expect(h.ops).toEqual([{ op: "reset", params: { ref: SHA, mode: "mixed" } }]);
        expect(h.dialogs).toEqual([]);
    });

    it("Reset soft also runs without confirmation: no edits are lost", async () => {
        const h = makeHarness();
        h.setPicks(["Soft"]);
        await graphResetAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([{ op: "reset", params: { ref: SHA, mode: "soft" } }]);
        expect(h.dialogs).toEqual([]);
    });

    it("Reset hard requires confirmation; declining cancels the operation", async () => {
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

    it("a cancelled mode picker does nothing", async () => {
        const h = makeHarness();
        h.setPicks([undefined]);
        await graphResetAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([]);
        expect(h.dialogs).toEqual([]);
    });

    it("an unrecognized picker answer never reaches git", async () => {
        const h = makeHarness();
        h.setPicks(["Rebase"]);
        await graphResetAction.run(h.accessor, SHA);
        expect(h.ops).toEqual([]);
        expect(h.dialogs).toEqual([]);
    });

    it("Copy Commit ID and Copy Commit Message put the values on the clipboard", async () => {
        const h = makeHarness();
        await graphCopyCommitIdAction.run(h.accessor, SHA);
        await graphCopyCommitMessageAction.run(h.accessor, "feat: panel");
        expect(h.clipboard).toEqual([SHA, "feat: panel"]);
    });

    it("without an argument (invoked from the palette) the commands exit silently", async () => {
        const h = makeHarness();
        for (const action of GRAPH_COMMIT_ACTIONS) {
            await action.run(h.accessor, undefined);
            await action.run(h.accessor, "");
        }
        expect(h.ops).toEqual([]);
        expect(h.clipboard).toEqual([]);
        expect(h.dialogs).toEqual([]);
    });

    it("all graph commands sit in the commit menu and get its argument", () => {
        for (const action of GRAPH_COMMIT_ACTIONS) {
            expect(action.menus, action.id).toHaveLength(1);
            expect(action.menus![0].args, action.id).toBeDefined();
        }
    });

    it("the argument is resolved from the menu context: sha for all except Copy Commit Message", () => {
        const context: ScmGraphMenuContext = { sha: SHA, shortSha: SHA.slice(0, 8), subject: "feat: panel" };
        const argOf = (action: (typeof GRAPH_COMMIT_ACTIONS)[number]): unknown => action.menus![0].args!(context)[0];

        expect(argOf(graphCopyCommitMessageAction)).toBe("feat: panel");
        for (const action of GRAPH_COMMIT_ACTIONS) {
            if (action === graphCopyCommitMessageAction) continue;
            expect(argOf(action), action.id).toBe(SHA);
        }
    });
});
