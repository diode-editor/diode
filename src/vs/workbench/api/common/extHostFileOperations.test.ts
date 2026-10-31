import { describe, expect, it, vi } from "vitest";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";

import { ExtHostFileOperations } from "./extHostFileOperations.ts";
import type { HostRpc, SubprocessRpc } from "./extHostProtocol.ts";
import { createInProcessChannelPair } from "./inProcessChannelPair.ts";
import { RpcEndpoint } from "./rpcEndpoint.ts";
import { Uri, WorkspaceEdit } from "./vscodeTypes.ts";

const OLD = "file:///old.txt";
const NEW = "file:///new.txt";

function setup() {
    const [a, b] = createInProcessChannelPair();
    const host: HostRpc = new RpcEndpoint(a);
    const subprocess: SubprocessRpc = new RpcEndpoint(b);
    const subscriptions: boolean[] = [];
    host.handleNotification("workspace.updateFileOperationSubscriptions", (params) => {
        subscriptions.push(params.will);
    });
    return { host, operations: new ExtHostFileOperations(subprocess), subscriptions };
}

function insertEdit(text: string): WorkspaceEdit {
    const edit = new WorkspaceEdit();
    edit.createFile(Uri.parse(`file:///${text}`));
    return edit;
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("ExtHostFileOperations", () => {
    it("[api:workspace.onDidRenameFiles] [api:workspace.onDidCreateFiles] [api:workspace.onDidDeleteFiles] maps the operation to its event; a copy is a create", async () => {
        const { host, operations } = setup();
        const log: string[] = [];
        operations.onDidRenameFiles((e) =>
            log.push(`rename ${e.files[0].oldUri.toString()} ${e.files[0].newUri.toString()}`),
        );
        operations.onDidCreateFiles((e) => log.push(`create ${e.files[0].toString()}`));
        operations.onDidDeleteFiles((e) => log.push(`delete ${e.files[0].toString()}`));

        host.notify("workspace.didRunFileOperation", { operation: "move", files: [{ source: OLD, target: NEW }] });
        host.notify("workspace.didRunFileOperation", { operation: "create", files: [{ target: NEW }] });
        host.notify("workspace.didRunFileOperation", { operation: "copy", files: [{ source: OLD, target: NEW }] });
        host.notify("workspace.didRunFileOperation", { operation: "delete", files: [{ target: OLD }] });
        await flush();

        expect(log).toEqual([`rename ${OLD} ${NEW}`, `create ${NEW}`, `create ${NEW}`, `delete ${OLD}`]);
    });

    it("[api:workspace.onWillRenameFiles] [api:workspace.onWillCreateFiles] [api:workspace.onWillDeleteFiles] maps the operation to its will event with all the files", async () => {
        const { host, operations } = setup();
        const log: string[] = [];
        operations.onWillRenameFiles((e) =>
            log.push(`rename ${String(e.files.length)} ${e.files[1].oldUri.toString()}`),
        );
        operations.onWillCreateFiles((e) => log.push(`create ${e.files[0].toString()}`));
        operations.onWillDeleteFiles((e) => log.push(`delete ${e.files[0].toString()}`));
        const request = (
            operation: "move" | "create" | "copy" | "delete",
            files: { source?: string; target: string }[],
        ) => host.request("workspace.willRunFileOperation", { operation, files, timeoutMs: 1000 });

        await request("move", [
            { source: NEW, target: OLD },
            { source: OLD, target: NEW },
        ]);
        await request("create", [{ target: NEW }]);
        await request("copy", [{ source: OLD, target: NEW }]);
        await request("delete", [{ target: OLD }]);

        expect(log).toEqual([`rename 2 ${OLD}`, `create ${NEW}`, `create ${NEW}`, `delete ${OLD}`]);
    });

    it("returns the edits of all listeners, in listener order, ignoring what isn't an edit", async () => {
        const { host, operations } = setup();
        operations.onWillDeleteFiles((e) => {
            e.waitUntil(Promise.resolve(insertEdit("first")));
            e.waitUntil(Promise.resolve("not an edit"));
        });
        operations.onWillDeleteFiles((e) => {
            e.waitUntil(Promise.resolve(insertEdit("second")));
        });

        const ops = await host.request("workspace.willRunFileOperation", {
            operation: "delete",
            files: [{ target: OLD }],
            timeoutMs: 1000,
        });

        expect(ops).toEqual([
            expect.objectContaining({ kind: "create", resource: "file:///first" }),
            expect.objectContaining({ kind: "create", resource: "file:///second" }),
        ]);
    });

    it("a listener is waited for before the next one runs", async () => {
        const { host, operations } = setup();
        const log: string[] = [];
        let release = (): void => undefined;
        operations.onWillCreateFiles((e) => {
            log.push("first");
            e.waitUntil(
                new Promise<void>((resolve) => {
                    release = () => {
                        log.push("released");
                        resolve();
                    };
                }),
            );
        });
        operations.onWillCreateFiles(() => {
            log.push("second");
        });

        const pending = host.request("workspace.willRunFileOperation", {
            operation: "create",
            files: [{ target: NEW }],
            timeoutMs: 1000,
        });
        await flush();
        expect(log).toEqual(["first"]);

        release();
        await pending;
        expect(log).toEqual(["first", "released", "second"]);
    });

    it("waitUntil outside the dispatch throws, as upstream", async () => {
        const { host, operations } = setup();
        let late: (() => void) | undefined;
        operations.onWillCreateFiles((e) => {
            late = () => {
                e.waitUntil(Promise.resolve());
            };
        });

        await host.request("workspace.willRunFileOperation", {
            operation: "create",
            files: [{ target: NEW }],
            timeoutMs: 1000,
        });

        expect(late).toThrow("waitUntil can NOT be called asynchronous");
    });

    it("a throwing listener or a rejected waitUntil loses only its own part", async () => {
        const { host, operations } = setup();
        operations.onWillDeleteFiles(() => {
            throw new Error("listener bug");
        });
        operations.onWillDeleteFiles((e) => {
            e.waitUntil(Promise.reject(new Error("edit bug")));
            e.waitUntil(Promise.resolve(insertEdit("kept")));
        });

        const ops = await host.request("workspace.willRunFileOperation", {
            operation: "delete",
            files: [{ target: OLD }],
            timeoutMs: 1000,
        });

        expect(ops).toEqual([expect.objectContaining({ resource: "file:///kept" })]);
    });

    it("cancellation stops the remaining listeners and drops the edits", async () => {
        const { host, operations } = setup();
        const second = vi.fn();
        const source = new CancellationTokenSource();
        operations.onWillCreateFiles((e) => {
            e.waitUntil(Promise.resolve(insertEdit("dropped")));
            source.cancel();
        });
        operations.onWillCreateFiles(second);

        const reply = host.request(
            "workspace.willRunFileOperation",
            { operation: "create", files: [{ target: NEW }], timeoutMs: 1000 },
            { token: source.token },
        );

        // Whichever comes first, the cancellation or the reply: no edit gets through.
        await expect(reply.catch(() => [])).resolves.toEqual([]);
        await flush();
        expect(second).not.toHaveBeenCalled();
    });

    it("the event's cancellation token is there and the event is frozen", async () => {
        const { host, operations } = setup();
        const seen: { cancelled?: boolean; frozen?: boolean } = {};
        operations.onWillCreateFiles((e) => {
            seen.cancelled = e.token.isCancellationRequested;
            seen.frozen = Object.isFrozen(e);
        });

        await host.request("workspace.willRunFileOperation", {
            operation: "create",
            files: [{ target: NEW }],
            timeoutMs: 1000,
        });

        expect(seen).toEqual({ cancelled: false, frozen: true });
    });

    it("tells the host about will listeners only at the edges, across all three events", async () => {
        const { operations, subscriptions } = setup();
        const first = operations.onWillCreateFiles(() => undefined);
        const second = operations.onWillRenameFiles(() => undefined);
        await flush();
        expect(subscriptions).toEqual([true]);

        first.dispose();
        first.dispose();
        await flush();
        expect(subscriptions).toEqual([true]);

        second.dispose();
        await flush();
        expect(subscriptions).toEqual([true, false]);
    });

    it("passes thisArgs and collects the disposable, as every vscode event", async () => {
        const { host, operations } = setup();
        const self = { seen: false };
        const disposables: { dispose(): void }[] = [];
        operations.onWillDeleteFiles(
            function (this: typeof self) {
                this.seen = true;
            },
            self,
            disposables,
        );
        await host.request("workspace.willRunFileOperation", {
            operation: "delete",
            files: [{ target: OLD }],
            timeoutMs: 1000,
        });
        expect(self.seen).toBe(true);
        expect(disposables).toHaveLength(1);
    });
});
