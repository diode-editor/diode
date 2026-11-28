import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeCtx() {
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

describe("WindowNamespace — window.state and onDidChangeWindowState", () => {
    it("starts focused and active", () => {
        const { window } = makeCtx();
        expect({ ...window.state }).toStrictEqual({ focused: true, active: true });
    });

    it("one event per changed property, the payload is the whole state; a repeat fires nothing", () => {
        const { stub, window } = makeCtx();
        const seen: vscode.WindowState[] = [];
        window.onDidChangeWindowState((state) => seen.push({ ...state }));
        stub.fire("window.focusChanged", { focused: true });
        stub.fire("window.activeChanged", { active: true });
        stub.fire("window.focusChanged", { focused: false });
        stub.fire("window.focusChanged", { focused: false });
        stub.fire("window.activeChanged", { active: false });
        stub.fire("window.focusChanged", { focused: true });
        expect(seen).toStrictEqual([
            { focused: false, active: true },
            { focused: false, active: false },
            { focused: true, active: false },
        ]);
    });

    it("a saved state is a frozen snapshot; a fresh read follows", () => {
        const { stub, window } = makeCtx();
        const saved = window.state;
        stub.fire("window.focusChanged", { focused: false });
        expect(saved.focused).toBe(true);
        expect(window.state.focused).toBe(false);
        expect(Object.isFrozen(saved)).toBe(true);
        expect(Object.isFrozen(window.state)).toBe(true);
    });

    it("a malformed message changes nothing and fires nothing", () => {
        const { stub, window } = makeCtx();
        let fired = 0;
        window.onDidChangeWindowState(() => fired++);
        stub.fire("window.focusChanged", { focused: "no" });
        stub.fire("window.activeChanged", { focused: false });
        stub.fire("window.activeChanged", null);
        stub.fire("window.focusChanged", 1);
        expect(fired).toBe(0);
        expect({ ...window.state }).toStrictEqual({ focused: true, active: true });
    });

    it("thisArgs binds the listener, disposables collect the subscription, a throwing listener spares the rest", () => {
        const { stub, window } = makeCtx();
        const receiver = { got: [] as boolean[] };
        const disposables: vscode.Disposable[] = [];
        window.onDidChangeWindowState(() => {
            throw new Error("boom");
        });
        window.onDidChangeWindowState(
            function (this: typeof receiver, state) {
                this.got.push(state.focused);
            },
            receiver,
            disposables,
        );
        stub.fire("window.focusChanged", { focused: false });
        expect(receiver.got).toStrictEqual([false]);
        expect(disposables).toHaveLength(1);
        disposables[0].dispose();
        stub.fire("window.focusChanged", { focused: true });
        expect(receiver.got).toStrictEqual([false]);
    });
});
