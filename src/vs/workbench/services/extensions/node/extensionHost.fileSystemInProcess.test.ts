import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

// The in-process pair hits guard branches on foreign params that an honest subprocess never sends.

const NOOP_EDITOR_OPTIONS = {
    getActiveEditorOptions: () => null,
    setActiveEditorOptions: () => undefined,
    getActiveEditorFilePath: () => null,
    getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
    onActiveEditorChanged: () => ({ dispose: () => undefined }),
    onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
} as unknown as IEditorOptionsService;

const NOOP_COMMANDS = {
    execute: () => undefined,
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

function makeHost() {
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    // installHostHandlers does not set this.rpc (spawn does).
    const attachRpc = () => {
        (host as unknown as { rpc: RpcEndpoint | null }).rpc = hostRpc;
    };
    return { host, peer, attachRpc };
}

describe("ExtensionHost — FS provider notifications (in-process)", () => {
    it("the scheme list updates and notifies subscribers", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onFileSystemProvidersChanged(seen);

        peer.notify("workspace.fileSystemProvidersChanged", { schemes: ["git", "output"] });
        await flushMicrotasks();

        expect(host.getFileSystemSchemes()).toEqual(["git", "output"]);
        expect(seen).toHaveBeenCalledTimes(1);
    });

    it("non-string schemes are filtered out, a non-array yields an empty list", async () => {
        const { host, peer } = makeHost();

        peer.notify("workspace.fileSystemProvidersChanged", { schemes: ["git", 42, null] });
        await flushMicrotasks();
        expect(host.getFileSystemSchemes()).toEqual(["git"]);

        peer.notify("workspace.fileSystemProvidersChanged", { schemes: "not an array" });
        await flushMicrotasks();
        expect(host.getFileSystemSchemes()).toEqual([]);
    });

    it("unsubscribing from scheme changes works", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onFileSystemProvidersChanged(seen).dispose();

        peer.notify("workspace.fileSystemProvidersChanged", { schemes: ["git"] });
        await flushMicrotasks();

        expect(seen).not.toHaveBeenCalled();
    });

    it("resource changes reach subscribers", async () => {
        const { host, peer } = makeHost();
        const seen: string[] = [];
        host.onDidChangeProvidedFile((uris) => {
            for (const uri of uris) seen.push(uri.toString());
        });

        peer.notify("workspace.fs.didChangeFile", { uris: ["git:/a.ts", "git:/b.ts"] });
        await flushMicrotasks();

        expect(seen).toEqual(["git:/a.ts", "git:/b.ts"]);
    });

    it("an empty or structurally foreign change list does not notify subscribers", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onDidChangeProvidedFile(seen);

        peer.notify("workspace.fs.didChangeFile", { uris: [] });
        peer.notify("workspace.fs.didChangeFile", { uris: "not an array" });
        peer.notify("workspace.fs.didChangeFile", { uris: [42] });
        await flushMicrotasks();

        expect(seen).not.toHaveBeenCalled();
    });

    it("unsubscribing from resource changes works", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onDidChangeProvidedFile(seen).dispose();

        peer.notify("workspace.fs.didChangeFile", { uris: ["git:/a.ts"] });
        await flushMicrotasks();

        expect(seen).not.toHaveBeenCalled();
    });

    it("disposing subscriptions twice is safe", () => {
        // The second dispose is not a duplicate: the owner calls it both directly and via the Disposable set.
        const { host } = makeHost();
        const schemes = host.onFileSystemProvidersChanged(() => undefined);
        const files = host.onDidChangeProvidedFile(() => undefined);

        schemes.dispose();
        files.dispose();

        expect(() => {
            schemes.dispose();
            files.dispose();
        }).not.toThrow();
    });

    it("readProvidedFile rejects without a running host", async () => {
        const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});

        await expect(host.readProvidedFile(Uri.parse("git:/a.ts"))).rejects.toThrow(/extension host is not running/);
    });

    it("readProvidedFile sends a request to the subprocess and parses the response", async () => {
        const { host, peer, attachRpc } = makeHost();
        attachRpc();
        peer.handleRequest("workspace.fs.readFile", (params) => {
            expect(params).toEqual({ uri: "git:/a.ts" });
            return { content: Buffer.from("original", "utf8").toString("base64") };
        });

        const bytes = await host.readProvidedFile(Uri.parse("git:/a.ts"));

        expect(new TextDecoder().decode(bytes)).toBe("original");
    });
});
