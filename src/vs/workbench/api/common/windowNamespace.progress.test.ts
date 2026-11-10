import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { ProgressLocation } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeWindow() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    return { stub, window: createWindowNamespace(ctx) };
}

function progressNotifies(stub: ReturnType<typeof makeWindow>["stub"]): { method: string; params: unknown }[] {
    return stub.notifies.filter((n) => n.method.startsWith("window.progress."));
}

describe("WindowNamespace — window.withProgress (real)", () => {
    it("start → reports → end; the task result is returned", async () => {
        const { stub, window } = makeWindow();

        const result = await window.withProgress(
            { location: ProgressLocation.Window as never, title: "TS: starting" },
            (progress, token) => {
                expect(token.isCancellationRequested).toBe(false);
                progress.report({ message: "loading project" });
                progress.report({ increment: 30 });
                progress.report({ message: "indexing", increment: 20 });
                return Promise.resolve(42);
            },
        );

        expect(result).toBe(42);
        expect(progressNotifies(stub)).toEqual([
            {
                method: "window.progress.start",
                params: { handle: 1, title: "TS: starting", location: "window", cancellable: false },
            },
            { method: "window.progress.report", params: { handle: 1, message: "loading project" } },
            { method: "window.progress.report", params: { handle: 1, increment: 30 } },
            { method: "window.progress.report", params: { handle: 1, message: "indexing", increment: 20 } },
            { method: "window.progress.end", params: { handle: 1 } },
        ]);
    });

    it("task reject: end is still sent, the error is rethrown", async () => {
        const { stub, window } = makeWindow();

        await expect(
            window.withProgress({ location: ProgressLocation.Window as never, title: "boom" }, () =>
                Promise.reject(new Error("failed")),
            ),
        ).rejects.toThrow("failed");

        expect(progressNotifies(stub).map((n) => n.method)).toEqual(["window.progress.start", "window.progress.end"]);
    });

    it("handle is unique per call; without title an empty string is sent", async () => {
        const { stub, window } = makeWindow();
        await window.withProgress({ location: ProgressLocation.Window as never, title: "a" }, () => Promise.resolve(1));
        await window.withProgress({ location: ProgressLocation.Window as never }, () => Promise.resolve(2));

        const starts = progressNotifies(stub).filter((n) => n.method === "window.progress.start");
        expect(starts).toEqual([
            {
                method: "window.progress.start",
                params: { handle: 1, title: "a", location: "window", cancellable: false },
            },
            {
                method: "window.progress.start",
                params: { handle: 2, title: "", location: "window", cancellable: false },
            },
        ]);
    });

    it("garbage report values are dropped field by field", async () => {
        const { stub, window } = makeWindow();
        await window.withProgress({ location: ProgressLocation.Window as never, title: "t" }, (progress) => {
            progress.report(null as never);
            progress.report({ message: 42, increment: "x" } as never);
            progress.report({ increment: Number.NaN } as never);
            return Promise.resolve(0);
        });

        const reports = progressNotifies(stub).filter((n) => n.method === "window.progress.report");
        // Malformed fields are dropped; the envelope stays valid (handle only).
        expect(reports).toEqual([
            { method: "window.progress.report", params: { handle: 1 } },
            { method: "window.progress.report", params: { handle: 1 } },
            { method: "window.progress.report", params: { handle: 1 } },
        ]);
    });

    it.each([
        [ProgressLocation.Notification, "notification"],
        [ProgressLocation.SourceControl, "sourceControl"],
        [ProgressLocation.Window, "window"],
        [{ viewId: "explorer" }, { viewId: "explorer" }],
        [99, "window"],
        [{ viewId: 3 }, "window"],
        [null, "window"],
    ])("[api:window.withProgress] location %o goes on the wire as %o", async (location, wire) => {
        const { stub, window } = makeWindow();
        await window.withProgress({ location: location as never, cancellable: true }, () => Promise.resolve(0));

        expect(progressNotifies(stub)[0].params).toEqual({ handle: 1, title: "", location: wire, cancellable: true });
    });

    it("[api:window.withProgress] window.progress.cancel fires the token once and sets isCancellationRequested", async () => {
        const { stub, window } = makeWindow();
        const fired: unknown[] = [];
        let release!: () => void;
        const result = window.withProgress(
            { location: ProgressLocation.Notification as never, title: "long", cancellable: true },
            (_progress, token) => {
                token.onCancellationRequested((e) => fired.push(e));
                return new Promise<string>((resolve) => {
                    release = () => {
                        resolve(token.isCancellationRequested ? "cancelled" : "done");
                    };
                });
            },
        );

        stub.fire("window.progress.cancel", { handle: 1 });
        stub.fire("window.progress.cancel", { handle: 1 });
        release();

        // The task decides what withProgress resolves to; cancel does not reject it.
        await expect(result).resolves.toBe("cancelled");
        expect(fired).toHaveLength(1);
    });

    it("[api:window.withProgress] without cancellable the token never fires", async () => {
        const { stub, window } = makeWindow();
        let token!: { isCancellationRequested: boolean };
        let fired = false;
        let release!: () => void;
        let listener!: { dispose(): unknown };
        const result = window.withProgress({ location: ProgressLocation.Notification as never }, (_p, t) => {
            token = t;
            listener = t.onCancellationRequested(() => {
                fired = true;
            });
            return new Promise<void>((resolve) => {
                release = resolve;
            });
        });

        stub.fire("window.progress.cancel", { handle: 1 });
        release();
        await result;

        expect(fired).toBe(false);
        expect(token.isCancellationRequested).toBe(false);
        // The subscription is a disposable like any other.
        expect(() => listener.dispose()).not.toThrow();
    });

    it("a cancel for another handle, a finished one or garbage changes nothing", async () => {
        const { stub, window } = makeWindow();
        await window.withProgress({ location: ProgressLocation.Notification as never, cancellable: true }, () =>
            Promise.resolve(0),
        );
        const seen: boolean[] = [];
        let release!: () => void;
        const result = window.withProgress(
            { location: ProgressLocation.Notification as never, cancellable: true },
            (_p, token) => {
                token.onCancellationRequested(() => seen.push(true));
                return new Promise<void>((resolve) => {
                    release = resolve;
                });
            },
        );

        stub.fire("window.progress.cancel", { handle: 1 });
        stub.fire("window.progress.cancel", { handle: 9 });
        stub.fire("window.progress.cancel", { handle: "2" });
        stub.fire("window.progress.cancel", null);
        release();
        await result;

        expect(seen).toEqual([]);
    });

    it("a cancel after the task finished does not reach the token the task kept", async () => {
        const { stub, window } = makeWindow();
        let kept!: { isCancellationRequested: boolean };
        await window.withProgress(
            { location: ProgressLocation.Notification as never, cancellable: true },
            (_p, token) => {
                kept = token;
                return Promise.resolve(0);
            },
        );

        stub.fire("window.progress.cancel", { handle: 1 });

        expect(kept.isCancellationRequested).toBe(false);
    });

    it("[api:window.withProgress] a synchronous throw still sends end and rejects", async () => {
        const { stub, window } = makeWindow();

        const result = window.withProgress({ location: ProgressLocation.Notification as never, title: "x" }, () => {
            throw new Error("sync boom");
        });

        await expect(result).rejects.toThrow("sync boom");
        expect(progressNotifies(stub).map((n) => n.method)).toEqual(["window.progress.start", "window.progress.end"]);
    });
});
