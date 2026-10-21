import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import type { IStubRpc } from "./testStubRpc.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import type { IWireStatusBarItem } from "./wireTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeWindow(): { stub: IStubRpc; window: typeof vscode.window; owner: ExtensionOwner } {
    const stub = makeStubRpc();
    const owner = new ExtensionOwner();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner,
    };
    return { stub, window: createWindowNamespace(ctx), owner };
}

/** `null` means the item is hidden or not created. */
function shownMessage(stub: IStubRpc): string | null {
    let shown: IWireStatusBarItem | null = null;
    for (const n of stub.notifies) {
        if (n.method === "window.statusBarItem.update") shown = n.params as IWireStatusBarItem;
        if (n.method === "window.statusBarItem.dispose") shown = null;
    }
    return shown?.text ?? null;
}

function lastUpdate(stub: IStubRpc): IWireStatusBarItem | undefined {
    return stub.notifies.filter((n) => n.method === "window.statusBarItem.update").at(-1)?.params as
        | IWireStatusBarItem
        | undefined;
}

describe("window.setStatusBarMessage", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows the message as the upstream item: ownerless id, left side, name 'Extension Status'", () => {
        const { stub, window, owner } = makeWindow();
        // Called by an extension, but the item is shared: its id has no owner prefix.
        owner.runAs("anthropic.claude-code", () => window.setStatusBarMessage("Claude Code: hi"));
        expect(lastUpdate(stub)).toStrictEqual({
            handle: 1,
            id: "status.extensionMessage",
            alignment: "left",
            priority: Number.MIN_VALUE,
            text: "Claude Code: hi",
            name: "Extension Status",
        });
    });

    it("before any message there is no item and nothing goes over the wire", () => {
        const { stub, window } = makeWindow();
        // Extension items are not shifted: the first one gets its handle 1.
        window.createStatusBarItem().show();
        expect(lastUpdate(stub)?.handle).toBe(1);
        expect(stub.notifies.filter((n) => n.method.startsWith("window.statusBarItem.")).length).toBe(1);
    });

    it("messages stack: newest is visible, removing the top restores the previous, empty stack hides the item", () => {
        const { stub, window } = makeWindow();
        const first = window.setStatusBarMessage("first");
        const second = window.setStatusBarMessage("second");
        expect(shownMessage(stub)).toBe("second");
        second.dispose();
        expect(shownMessage(stub)).toBe("first");
        first.dispose();
        expect(shownMessage(stub)).toBeNull();
    });

    it("removing the bottom message leaves the top alone; repeated dispose is harmless", () => {
        const { stub, window } = makeWindow();
        const first = window.setStatusBarMessage("first");
        window.setStatusBarMessage("second");
        first.dispose();
        first.dispose();
        expect(shownMessage(stub)).toBe("second");
    });

    it("identical texts are distinct messages", () => {
        const { stub, window } = makeWindow();
        const a = window.setStatusBarMessage("same");
        window.setStatusBarMessage("same");
        a.dispose();
        expect(shownMessage(stub)).toBe("same");
    });

    it("timeout removes the message after the given milliseconds", () => {
        const { stub, window } = makeWindow();
        window.setStatusBarMessage("tick", 3000);
        vi.advanceTimersByTime(2999);
        expect(shownMessage(stub)).toBe("tick");
        vi.advanceTimersByTime(1);
        expect(shownMessage(stub)).toBeNull();
    });

    it("dispose before the timeout removes it immediately and clears the timer", () => {
        const { stub, window } = makeWindow();
        const message = window.setStatusBarMessage("tick", 3000);
        message.dispose();
        expect(shownMessage(stub)).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("thenable: message lives until it settles, on both resolve and reject", async () => {
        const { stub, window } = makeWindow();
        let resolve!: () => void;
        let reject!: (e: unknown) => void;
        window.setStatusBarMessage("ok", new Promise<void>((r) => (resolve = r)));
        window.setStatusBarMessage(
            "fail",
            new Promise<void>((_, r) => {
                reject = r;
            }),
        );
        expect(shownMessage(stub)).toBe("fail");
        reject(new Error("x"));
        await vi.runAllTimersAsync();
        expect(shownMessage(stub)).toBe("ok");
        resolve();
        await vi.runAllTimersAsync();
        expect(shownMessage(stub)).toBeNull();
    });

    it("without a timeout the message stays until removed", () => {
        const { stub, window } = makeWindow();
        window.setStatusBarMessage("sticky");
        vi.advanceTimersByTime(60_000);
        expect(shownMessage(stub)).toBe("sticky");
    });
});
