import { describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import type { WireTestsDiffOp } from "./testingWireTypes.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

const ID = (...path: string[]): string => path.join("\0");

function makeVscode() {
    const stub = makeStubRpc();
    const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
    return { stub, vscode: namespace };
}

function sent(stub: ReturnType<typeof makeStubRpc>, method: string): unknown[] {
    return stub.notifies.filter((n) => n.method === method).map((n) => n.params);
}

/** `expand` of every op that carries one, in order: Add as `+id=state`, Update as `id=state`. */
function expandStates(stub: ReturnType<typeof makeStubRpc>): string[] {
    const ops = (sent(stub, "testing.publishDiff") as { diff: WireTestsDiffOp[] }[]).flatMap((p) => p.diff);
    return ops.flatMap((op) => {
        if (op.op === 0) return [`+${op.item.item.extId.replaceAll("\0", "/")}=${op.item.expand}`];
        if (op.op === 1 && op.item.expand !== undefined)
            return [`${op.item.extId.replaceAll("\0", "/")}=${op.item.expand}`];
        return [];
    });
}

describe("vscode.tests — controllers reach the host", () => {
    it("[api:tests.createTestController] registration carries id and label; dispose unregisters", () => {
        const { stub, vscode } = makeVscode();
        const controller = vscode.tests.createTestController("go", "Go");
        expect(controller.id).toBe("go");
        expect(controller.label).toBe("Go");
        expect(controller.refreshHandler).toBeUndefined();
        expect(controller.resolveHandler).toBeUndefined();
        expect(sent(stub, "testing.registerController")).toEqual([
            { controllerId: "go", label: "Go", canRefresh: false },
        ]);
        expect(sent(stub, "output.append")).toEqual([]);
        controller.dispose();
        controller.dispose();
        expect(sent(stub, "testing.unregisterController")).toEqual([{ controllerId: "go" }]);
    });

    it("[api:tests.createTestController] a second controller with a live id throws, as upstream; after dispose the id is free", () => {
        const { vscode } = makeVscode();
        const first = vscode.tests.createTestController("go", "Go");
        expect(() => vscode.tests.createTestController("go", "Again")).toThrow(
            'Attempt to insert a duplicate controller with ID "go"',
        );
        first.dispose();
        const second = vscode.tests.createTestController("go", "Again");
        first.dispose();
        expect(second.label).toBe("Again");
    });

    it("[api:tests.createTestController] setting refreshHandler tells the host whether it can refresh", () => {
        const { stub, vscode } = makeVscode();
        const controller = vscode.tests.createTestController("go", "Go");
        const handler = (): void => undefined;
        controller.refreshHandler = handler;
        expect(controller.refreshHandler).toBe(handler);
        controller.refreshHandler = undefined;
        expect(sent(stub, "testing.updateController")).toEqual([
            { controllerId: "go", canRefresh: true },
            { controllerId: "go", canRefresh: false },
        ]);
    });
});

describe("vscode.tests — resolveHandler on the host's expand", () => {
    it("[api:tests.createTestController] without a handler nothing is expandable and an expand calls nothing", async () => {
        const { stub, vscode } = makeVscode();
        const controller = vscode.tests.createTestController("ctrl", "Ctrl");
        const file = controller.createTestItem("f", "F");
        file.canResolveChildren = true;
        controller.items.add(file);
        await stub.callRequest("testing.expandTest", { testId: "ctrl", levels: 0 });
        await stub.callRequest("testing.expandTest", { testId: "unknown", levels: 0 });
        expect(expandStates(stub)).toEqual(["+ctrl=0", "+ctrl/f=0"]);
    });

    it("[api:tests.createTestController] root expand calls the handler with undefined; its tests reach the host before the reply", async () => {
        const { stub, vscode } = makeVscode();
        const controller = vscode.tests.createTestController("ctrl", "Ctrl");
        const calls: (string | undefined)[] = [];
        controller.resolveHandler = (item) => {
            calls.push(item?.id);
            const file = controller.createTestItem("f", "F");
            file.canResolveChildren = true;
            controller.items.add(file);
        };
        expect(controller.resolveHandler).toBeDefined();
        await stub.callRequest("testing.expandTest", { testId: "ctrl", levels: 0 });
        expect(calls).toEqual([undefined]);
        // Expandable, then busy: both land in the root's Add of the same batch.
        expect(expandStates(stub)).toEqual(["+ctrl=2", "+ctrl/f=1", "ctrl=3"]);
    });

    it("[api:tests.createTestController] an item's expand passes the item; it is busy while the handler runs", async () => {
        const { stub, vscode } = makeVscode();
        const controller = vscode.tests.createTestController("ctrl", "Ctrl");
        const file = controller.createTestItem("f", "F");
        file.canResolveChildren = true;
        controller.items.add(file);
        let finish = (): void => undefined;
        const seen: unknown[] = [];
        controller.resolveHandler = (item) => {
            seen.push(item);
            return new Promise<void>((resolve) => {
                finish = resolve;
            });
        };
        const expanding = stub.callRequest("testing.expandTest", { testId: ID("ctrl", "f"), levels: 0 });
        await vi.waitFor(() => {
            expect(seen).toEqual([file]);
        });
        // A second expand while busy does not call again.
        await stub.callRequest("testing.expandTest", { testId: ID("ctrl", "f"), levels: 0 });
        expect(seen).toHaveLength(1);
        controller.items.get("f")?.children.add(controller.createTestItem("t", "T"));
        finish();
        await expanding;
        expect(expandStates(stub).slice(-3)).toEqual(["ctrl/f=2", "+ctrl/f/t=0", "ctrl/f=3"]);
        await stub.callRequest("testing.expandTest", { testId: ID("ctrl", "f"), levels: 0 });
        expect(seen).toHaveLength(1);
    });

    it("[api:tests.createTestController] levels expand the children too; a negative level is all of them", async () => {
        const { stub, vscode } = makeVscode();
        const controller = vscode.tests.createTestController("ctrl", "Ctrl");
        const seen: string[] = [];
        controller.resolveHandler = (item) => {
            seen.push(item?.id ?? "<root>");
            const depth = item === undefined ? 0 : item.id.length;
            if (depth >= 3) return;
            const child = controller.createTestItem(`${item?.id ?? ""}x`, "X");
            child.canResolveChildren = true;
            (item?.children ?? controller.items).add(child);
        };
        await stub.callRequest("testing.expandTest", { testId: "ctrl", levels: 1 });
        expect(seen).toEqual(["<root>", "x"]);
        await stub.callRequest("testing.expandTest", { testId: "ctrl", levels: -1 });
        expect(seen).toEqual(["<root>", "x", "xx", "xxx"]);
    });

    it("[api:tests.createTestController] a throwing or rejecting handler is an Output line; the item ends expanded", async () => {
        const { stub, vscode } = makeVscode();
        const controller = vscode.tests.createTestController("ctrl", "Ctrl");
        const file = controller.createTestItem("f", "F");
        file.canResolveChildren = true;
        controller.items.add(file);
        controller.resolveHandler = (item) => {
            if (item === undefined) throw new Error("sync boom");
            return Promise.reject(new Error("async boom"));
        };
        await stub.callRequest("testing.expandTest", { testId: "ctrl", levels: 0 });
        await stub.callRequest("testing.expandTest", { testId: ID("ctrl", "f"), levels: 0 });
        expect(sent(stub, "output.append")).toEqual([
            {
                channel: "extensions",
                label: "Extensions",
                level: "error",
                value: 'Unhandled error in resolveHandler of test controller "ctrl": Error: sync boom',
            },
            {
                channel: "extensions",
                label: "Extensions",
                level: "error",
                value: 'Unhandled error in resolveHandler of test controller "ctrl": Error: async boom',
            },
        ]);
        expect(expandStates(stub).slice(-2)).toEqual(["ctrl=3", "ctrl/f=3"]);
    });

    it("an item that turns resolvable becomes expandable; one that was asked to expand resolves then", async () => {
        const { stub, vscode } = makeVscode();
        const controller = vscode.tests.createTestController("ctrl", "Ctrl");
        const seen: string[] = [];
        controller.resolveHandler = (item) => {
            seen.push(item?.id ?? "<root>");
        };
        const file = controller.createTestItem("f", "F");
        controller.items.add(file);
        await stub.callRequest("testing.expandTest", { testId: "ctrl", levels: 1 });
        expect(seen).toEqual(["<root>"]);
        file.canResolveChildren = true;
        await vi.waitFor(() => {
            expect(seen).toEqual(["<root>", "f"]);
        });
        controller.resolveHandler = undefined;
        expect(controller.resolveHandler).toBeUndefined();
        await stub.callRequest("testing.expandTest", { testId: "ctrl", levels: 0 });
        expect(expandStates(stub).slice(-2)).toEqual(["ctrl=0", "ctrl/f=0"]);
    });

    it("an expanded item replaced by a new instance expands again", async () => {
        const { stub, vscode } = makeVscode();
        const controller = vscode.tests.createTestController("ctrl", "Ctrl");
        const seen: unknown[] = [];
        controller.resolveHandler = (item) => {
            seen.push(item);
        };
        const first = controller.createTestItem("f", "F");
        first.canResolveChildren = true;
        controller.items.add(first);
        await stub.callRequest("testing.expandTest", { testId: ID("ctrl", "f"), levels: 0 });
        const second = controller.createTestItem("f", "F");
        second.canResolveChildren = true;
        controller.items.add(second);
        await vi.waitFor(() => {
            expect(seen).toEqual([first, second]);
        });
    });
});

describe("vscode.tests — refreshHandler on the host's refresh", () => {
    it("[api:tests.createTestController] the host's request awaits the handler; its cancellation cancels the token", async () => {
        const { stub, vscode } = makeVscode();
        let token: vscodeTypes.CancellationToken | undefined;
        let finish = (): void => undefined;
        vscode.tests.createTestController("go", "Go").refreshHandler = (t) => {
            token = t;
            return new Promise<void>((resolve) => {
                finish = resolve;
            });
        };
        const cts = new CancellationTokenSource();
        let replied = false;
        const refreshing = stub.callRequest("testing.refreshTests", { controllerId: "go" }, cts.token).then(() => {
            replied = true;
        });
        await vi.waitFor(() => {
            expect(token).toBeDefined();
        });
        expect(token?.isCancellationRequested).toBe(false);
        cts.cancel();
        expect(token?.isCancellationRequested).toBe(true);
        await Promise.resolve();
        expect(replied).toBe(false);
        finish();
        await refreshing;
        expect(replied).toBe(true);
    });

    it("a controller without a handler or an unknown one answers at once", async () => {
        const { stub, vscode } = makeVscode();
        vscode.tests.createTestController("py", "Python");
        await expect(stub.callRequest("testing.refreshTests", { controllerId: "py" })).resolves.toBeNull();
        await expect(stub.callRequest("testing.refreshTests", { controllerId: "none" })).resolves.toBeNull();
    });
});

describe("vscode.tests — run profiles reach the host", () => {
    it("[api:tests.createTestController] each kind goes with its group bit, upstream defaults and a namespaced tag", () => {
        const { stub, vscode } = makeVscode();
        const controller = vscode.tests.createTestController("go", "Go");
        const run = vi.fn();
        const plain = controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, run);
        expect(plain).toMatchObject({
            label: "Run",
            kind: 1,
            isDefault: false,
            supportsContinuousRun: false,
            tag: undefined,
            configureHandler: undefined,
            runHandler: run,
        });
        const tag = new vscode.TestTag("unit");
        controller.createRunProfile("Debug", vscode.TestRunProfileKind.Debug, run, true, tag, true);
        controller.createRunProfile("Coverage", vscode.TestRunProfileKind.Coverage, run);
        const published = sent(stub, "testing.publishProfile") as Record<string, unknown>[];
        expect(published.map(({ profileId: _id, ...rest }) => rest)).toEqual([
            {
                controllerId: "go",
                label: "Run",
                group: 2,
                isDefault: false,
                tag: null,
                hasConfigurationHandler: false,
                supportsContinuousRun: false,
            },
            {
                controllerId: "go",
                label: "Debug",
                group: 4,
                isDefault: true,
                tag: ID("go", "unit"),
                hasConfigurationHandler: false,
                supportsContinuousRun: true,
            },
            {
                controllerId: "go",
                label: "Coverage",
                group: 8,
                isDefault: false,
                tag: null,
                hasConfigurationHandler: false,
                supportsContinuousRun: false,
            },
        ]);
        expect(new Set(published.map((p) => p.profileId)).size).toBe(3);
        expect(run).not.toHaveBeenCalled();
    });

    it("[api:tests.createTestController] two profiles of one label get distinct ids, stable for the label", () => {
        const first = makeVscode();
        const second = makeVscode();
        const ids = (env: ReturnType<typeof makeVscode>): unknown[] => {
            const controller = env.vscode.tests.createTestController("go", "Go");
            controller.createRunProfile("Run", env.vscode.TestRunProfileKind.Run, () => undefined);
            controller.createRunProfile("Run", env.vscode.TestRunProfileKind.Debug, () => undefined);
            return (sent(env.stub, "testing.publishProfile") as { profileId: number }[]).map((p) => p.profileId);
        };
        const a = ids(first);
        expect(a[0]).not.toBe(a[1]);
        expect(ids(second)).toEqual(a);
    });

    it("[api:tests.createTestController] edits go as updates, a same value sends nothing, dispose removes once", () => {
        const { stub, vscode } = makeVscode();
        const controller = vscode.tests.createTestController("go", "Go");
        const profile = controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, () => undefined);
        const { profileId } = (sent(stub, "testing.publishProfile") as { profileId: number }[])[0];
        profile.label = "Run all";
        profile.label = "Run all";
        profile.isDefault = true;
        profile.isDefault = true;
        profile.tag = new vscode.TestTag("unit");
        profile.tag = new vscode.TestTag("unit");
        profile.tag = undefined;
        profile.supportsContinuousRun = true;
        profile.supportsContinuousRun = true;
        expect(profile).toMatchObject({
            label: "Run all",
            isDefault: true,
            tag: undefined,
            supportsContinuousRun: true,
        });
        expect(sent(stub, "testing.updateProfile")).toEqual([
            { controllerId: "go", profileId, update: { label: "Run all" } },
            { controllerId: "go", profileId, update: { isDefault: true } },
            { controllerId: "go", profileId, update: { tag: ID("go", "unit") } },
            { controllerId: "go", profileId, update: { tag: null } },
            { controllerId: "go", profileId, update: { supportsContinuousRun: true } },
        ]);
        const listener = vi.fn();
        profile.onDidChangeDefault(listener);
        profile.dispose();
        profile.dispose();
        profile.label = "after";
        expect(sent(stub, "testing.removeProfile")).toEqual([{ controllerId: "go", profileId }]);
        expect(sent(stub, "testing.updateProfile")).toHaveLength(5);
        expect(listener).not.toHaveBeenCalled();
        // The disposed profile's id is free again.
        controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, () => undefined);
        expect((sent(stub, "testing.publishProfile") as { profileId: number }[])[1].profileId).toBe(profileId);
    });
});

describe("vscode.tests — runs are not wired yet", () => {
    it("a run accepts reports and ends once; invalidateTestResults is harmless", () => {
        const { vscode } = makeVscode();
        const controller = vscode.tests.createTestController("go", "Go");
        const item = controller.createTestItem("A", "TestA");
        const run = controller.createTestRun(new vscode.TestRunRequest([item]), "go test");
        expect(run.name).toBe("go test");
        expect(run.isPersisted).toBe(true);
        expect(run.token.isCancellationRequested).toBe(false);
        expect(controller.createTestRun(new vscode.TestRunRequest(), undefined, false).isPersisted).toBe(false);

        const message = new vscode.TestMessage("bad");
        run.enqueued(item);
        run.started(item);
        run.skipped(item);
        run.failed(item, message, 3);
        run.errored(item, [message]);
        run.passed(item, 1);
        run.appendOutput("ok\r\n");
        run.addCoverage(new vscode.FileCoverage(vscode.Uri.file("/a.go"), new vscode.TestCoverageCount(1, 2)));
        controller.invalidateTestResults();

        const ended = vi.fn();
        run.onDidDispose(ended);
        run.end();
        run.end();
        expect(ended).toHaveBeenCalledTimes(1);
    });

    it("an item has upstream defaults; collections iterate and call forEach with thisArg", () => {
        const { vscode } = makeVscode();
        const controller = vscode.tests.createTestController("go", "Go");
        const uri = vscode.Uri.file("/w/a_test.go");
        const item = controller.createTestItem("id", "a_test.go", uri);
        expect(item).toMatchObject({
            id: "id",
            label: "a_test.go",
            uri,
            parent: undefined,
            tags: [],
            canResolveChildren: false,
            busy: false,
            range: undefined,
            error: undefined,
            description: undefined,
            sortText: undefined,
        });
        controller.items.add(item);
        item.children.add(controller.createTestItem("A", "TestA"));
        const seen: string[] = [];
        const thisArg = { tag: "this" };
        item.children.forEach(function (this: unknown, child, collection) {
            expect(this).toBe(thisArg);
            expect(collection).toBe(item.children);
            seen.push(child.id);
        }, thisArg);
        expect(seen).toEqual(["A"]);
        expect(item.children.size).toBe(1);
        expect(controller.items.get("id")).toBe(item);
    });
});
