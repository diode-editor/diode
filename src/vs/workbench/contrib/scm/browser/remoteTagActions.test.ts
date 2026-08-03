import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";

import { ScmRepoStateServiceDIToken } from "./repoStateService.ts";
import { QUERY_COMMAND } from "./syncActions.ts";
import {
    gitAddRemoteAction,
    gitCreateTagAction,
    gitDeleteRemoteTagAction,
    gitDeleteTagAction,
    gitRemoveRemoteAction,
    gitShowOutputAction,
    REMOTE_TAG_ACTIONS,
} from "./remoteTagActions.ts";

interface IHarness {
    accessor: ServiceAccessor;
    ops: { op: string; params?: Record<string, unknown> }[];
    executed: string[];
    notices: string[];
    setRefs(refs: { name: string; kind: string }[]): void;
    setRemotes(remotes: string[]): void;
    setPicks(labels: (string | undefined)[]): void;
    setInputs(values: (string | undefined)[]): void;
    hasShowOutput: { value: boolean };
    validators: ((v: string) => string | null)[];
}

function makeHarness(): IHarness {
    let refs: { name: string; kind: string }[] = [];
    let remotes = ["origin"];
    let pickResults: (string | undefined)[] = [];
    let inputResults: (string | undefined)[] = [];
    const ops: { op: string; params?: Record<string, unknown> }[] = [];
    const executed: string[] = [];
    const notices: string[] = [];
    const validators: ((v: string) => string | null)[] = [];
    const hasShowOutput = { value: true };

    const services = new Map<unknown, unknown>([
        [
            CommandRegistryDIToken,
            {
                has: () => hasShowOutput.value,
                execute: (id: string, payload?: { op?: string; params?: Record<string, unknown> }) => {
                    if (id === GIT_OP_COMMAND) {
                        ops.push({ op: payload!.op!, params: payload!.params });
                        return { ok: true };
                    }
                    if (id === QUERY_COMMAND) return { refs: refs.map((r) => ({ sha: "a", subject: "s", ...r })) };
                    executed.push(id);
                    return undefined;
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
            QuickInputServiceDIToken,
            {
                quickPick: () => {
                    const label = pickResults.shift();
                    return Promise.resolve(label === undefined ? undefined : { label });
                },
                input: (opts: { validateInput?: (v: string) => string | null }) => {
                    if (opts.validateInput !== undefined) validators.push(opts.validateInput);
                    return Promise.resolve(inputResults.shift());
                },
            },
        ],
        [
            ScmRepoStateServiceDIToken,
            {
                get state() {
                    return {
                        branch: "main",
                        detached: false,
                        upstream: null,
                        ahead: 0,
                        behind: 0,
                        remotes,
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
        executed,
        notices,
        setRefs: (r) => {
            refs = r;
        },
        setRemotes: (r) => {
            remotes = r;
        },
        setPicks: (labels) => {
            pickResults = labels;
        },
        setInputs: (values) => {
            inputResults = values;
        },
        hasShowOutput,
        validators,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("remote-команды", () => {
    it("addRemote: URL → имя → op; отмены на каждом шаге", async () => {
        const h = makeHarness();
        h.setInputs(["https://x/y.git", "upstream"]);
        await gitAddRemoteAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "remoteAdd", params: { name: "upstream", url: "https://x/y.git" } }]);

        h.ops.length = 0;
        h.setInputs([undefined]);
        await gitAddRemoteAction.run(h.accessor);
        h.setInputs(["https://x", undefined]);
        await gitAddRemoteAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });

    it("removeRemote: единственный remote — сразу op; отмена пикера при нескольких", async () => {
        const h = makeHarness();
        await gitRemoveRemoteAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "remoteRemove", params: { name: "origin" } }]);

        h.ops.length = 0;
        h.setRemotes(["origin", "fork"]);
        h.setPicks([undefined]);
        await gitRemoveRemoteAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });

    it("валидаторы полей ввода: пустое значение — ошибка", async () => {
        const h = makeHarness();
        h.setInputs(["https://x", "up"]);
        await gitAddRemoteAction.run(h.accessor);
        h.setInputs(["v1.0", ""]);
        await gitCreateTagAction.run(h.accessor);

        expect(h.validators).toHaveLength(3); // url, имя remote, имя тега
        for (const validate of h.validators) {
            expect(validate("  ")).not.toBeNull();
            expect(validate("value")).toBeNull();
        }
    });
});

describe("tag-команды", () => {
    it("createTag: имя + пустое сообщение → lightweight; Escape на сообщении — отмена", async () => {
        const h = makeHarness();
        h.setInputs(["v1.0", ""]);
        await gitCreateTagAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "tagCreate", params: { name: "v1.0", message: "" } }]);

        h.ops.length = 0;
        h.setInputs(["v2.0", undefined]);
        await gitCreateTagAction.run(h.accessor);
        h.setInputs([undefined]);
        await gitCreateTagAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });

    it("deleteTag: пикер локальных тегов; пусто — notice", async () => {
        const h = makeHarness();
        h.setRefs([
            { name: "v1.0", kind: "tag" },
            { name: "main", kind: "head" },
        ]);
        h.setPicks(["v1.0"]);
        await gitDeleteTagAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "tagDelete", params: { name: "v1.0" } }]);

        h.ops.length = 0;
        h.setRefs([]);
        await gitDeleteTagAction.run(h.accessor);
        expect(h.ops).toEqual([]);
        expect(h.notices.some((n) => n.includes("no tags"))).toBe(true);
    });

    it("deleteRemoteTag: remote (пикер при нескольких) → тег → pushDelete; отмены", async () => {
        const h = makeHarness();
        h.setRemotes(["origin", "fork"]);
        h.setRefs([{ name: "v1.0", kind: "tag" }]);
        h.setPicks(["fork", "v1.0"]);
        await gitDeleteRemoteTagAction.run(h.accessor);
        expect(h.ops).toEqual([{ op: "pushDelete", params: { remote: "fork", ref: "v1.0" } }]);

        h.ops.length = 0;
        h.setPicks([undefined]);
        await gitDeleteRemoteTagAction.run(h.accessor);
        h.setPicks(["fork", undefined]);
        await gitDeleteRemoteTagAction.run(h.accessor);
        expect(h.ops).toEqual([]);
    });
});

describe("git.showOutput", () => {
    it("делегирует команде показа канала ext-host stdout; без неё — no-op", () => {
        const h = makeHarness();
        gitShowOutputAction.run(h.accessor);
        expect(h.executed).toEqual(["workbench.action.output.show.extensions.host.stdout"]);

        h.executed.length = 0;
        h.hasShowOutput.value = false;
        gitShowOutputAction.run(h.accessor);
        expect(h.executed).toEqual([]);
    });
});

describe("номенклатура", () => {
    it("id в стиле VS Code", () => {
        expect(REMOTE_TAG_ACTIONS.map((a) => a.id)).toEqual([
            "git.addRemote",
            "git.removeRemote",
            "git.createTag",
            "git.deleteTag",
            "git.deleteRemoteTag",
            "git.showOutput",
        ]);
    });
});
