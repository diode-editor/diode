import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

// An in-process RPC pair instead of a fork: guard branches for structurally foreign params
// that an honest subprocess never sends.

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
    listCommandIds: () => [],
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

function makeHost() {
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    // installHostHandlers does not set this.rpc (spawn does), so for
    // provideTextDocumentContent we plug in the same pair by hand.
    const attachRpc = () => {
        (host as unknown as { rpc: RpcEndpoint | null }).rpc = hostRpc;
    };
    return { host, peer, attachRpc };
}

describe("ExtensionHost — content providers for non-disk resources (in-process)", () => {
    it("the scheme list updates on a subprocess notification", async () => {
        const { host, peer } = makeHost();

        peer.notify("workspace.textDocumentContentProvidersChanged", { schemes: ["jdt", "class"] });
        await flushMicrotasks();

        expect(host.hasTextContentProvider("jdt")).toBe(true);
        expect(host.hasTextContentProvider("class")).toBe(true);
        expect(host.hasTextContentProvider("git")).toBe(false);
    });

    it("non-string schemes are filtered out, a non-array gives an empty list", async () => {
        const { host, peer } = makeHost();

        peer.notify("workspace.textDocumentContentProvidersChanged", { schemes: ["jdt", 42, null] });
        await flushMicrotasks();
        expect(host.hasTextContentProvider("jdt")).toBe(true);

        peer.notify("workspace.textDocumentContentProvidersChanged", { schemes: "not an array" });
        await flushMicrotasks();
        expect(host.hasTextContentProvider("jdt")).toBe(false);
    });

    it("before the first subscription the listener list is empty: the notification calls nobody", async () => {
        const { host, peer } = makeHost();

        peer.notify("workspace.textDocumentContentChanged", { uri: "jdt:/Foo.java" });
        await flushMicrotasks();

        const seen = vi.fn();
        host.onDidChangeTextContent(seen);
        peer.notify("workspace.textDocumentContentChanged", { uri: "jdt:/Bar.java" });
        await flushMicrotasks();

        expect(seen).toHaveBeenCalledTimes(1);
    });

    it("a resource change message reaches subscribers", async () => {
        const { host, peer } = makeHost();
        const seen: string[] = [];
        host.onDidChangeTextContent((uri) => seen.push(uri.toString()));

        peer.notify("workspace.textDocumentContentChanged", { uri: "jdt:/Foo.java" });
        await flushMicrotasks();

        expect(seen).toEqual(["jdt:/Foo.java"]);
    });

    it("a structurally foreign change message wakes no subscribers", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onDidChangeTextContent(seen);

        peer.notify("workspace.textDocumentContentChanged", {});
        peer.notify("workspace.textDocumentContentChanged", { uri: 42 });
        await flushMicrotasks();

        expect(seen).not.toHaveBeenCalled();
    });

    it("unsubscribing from content changes works", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onDidChangeTextContent(seen).dispose();

        peer.notify("workspace.textDocumentContentChanged", { uri: "jdt:/Foo.java" });
        await flushMicrotasks();

        expect(seen).not.toHaveBeenCalled();
    });

    it("a repeated subscription dispose does not remove SOMEONE ELSE'S", async () => {
        const { host, peer } = makeHost();
        const first = vi.fn();
        const second = vi.fn();
        const subscription = host.onDidChangeTextContent(first);
        host.onDidChangeTextContent(second);

        subscription.dispose();
        // The second dispose does not find its cb (idx = -1) and must not treat
        // that as "remove the last one": the neighboring subscription belongs to someone else.
        subscription.dispose();
        peer.notify("workspace.textDocumentContentChanged", { uri: "jdt:/Foo.java" });
        await flushMicrotasks();

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it("without a subprocess a content request is rejected rather than left hanging", async () => {
        const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});

        await expect(host.provideTextDocumentContent(Uri.parse("jdt:/Foo.java"))).rejects.toThrow(
            "extension host is not running",
        );
    });

    it("the subprocess answer is parsed: string, null and structural garbage", async () => {
        const { host, peer, attachRpc } = makeHost();
        attachRpc();
        let reply: unknown = { content: "class Foo {}" };
        peer.handleRequest("workspace.provideTextDocumentContent", () => reply);

        expect(await host.provideTextDocumentContent(Uri.parse("jdt:/Foo.java"))).toBe("class Foo {}");

        reply = { content: null };
        expect(await host.provideTextDocumentContent(Uri.parse("jdt:/Foo.java"))).toBeNull();

        reply = { content: 42 };
        await expect(host.provideTextDocumentContent(Uri.parse("jdt:/Foo.java"))).rejects.toThrow(
            /must be a string or null/u,
        );
    });
});
