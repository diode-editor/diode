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

/** `null` — пункт скрыт или не заведён. */
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

    it("показывает сообщение пунктом эталона: ничей id, слева, имя «Extension Status»", () => {
        const { stub, window, owner } = makeWindow();
        // Зовёт расширение — но пункт общий, префикса владельца у id нет.
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

    it("пока сообщений не было, пункта нет и по проводу ничего не едет", () => {
        const { stub, window } = makeWindow();
        // Пункты расширений не сдвигаются: первый получает свой handle 1.
        window.createStatusBarItem().show();
        expect(lastUpdate(stub)?.handle).toBe(1);
        expect(stub.notifies.filter((n) => n.method.startsWith("window.statusBarItem.")).length).toBe(1);
    });

    it("сообщения стеком: видно свежее, снятие верхнего возвращает прежнее, пустой стек прячет пункт", () => {
        const { stub, window } = makeWindow();
        const first = window.setStatusBarMessage("first");
        const second = window.setStatusBarMessage("second");
        expect(shownMessage(stub)).toBe("second");
        second.dispose();
        expect(shownMessage(stub)).toBe("first");
        first.dispose();
        expect(shownMessage(stub)).toBeNull();
    });

    it("снятие нижнего сообщения верхнее не трогает; повторный dispose безвреден", () => {
        const { stub, window } = makeWindow();
        const first = window.setStatusBarMessage("first");
        window.setStatusBarMessage("second");
        first.dispose();
        first.dispose();
        expect(shownMessage(stub)).toBe("second");
    });

    it("одинаковые тексты — разные сообщения", () => {
        const { stub, window } = makeWindow();
        const a = window.setStatusBarMessage("same");
        window.setStatusBarMessage("same");
        a.dispose();
        expect(shownMessage(stub)).toBe("same");
    });

    it("таймаут снимает сообщение через заданные миллисекунды", () => {
        const { stub, window } = makeWindow();
        window.setStatusBarMessage("tick", 3000);
        vi.advanceTimersByTime(2999);
        expect(shownMessage(stub)).toBe("tick");
        vi.advanceTimersByTime(1);
        expect(shownMessage(stub)).toBeNull();
    });

    it("dispose до таймаута снимает сразу и гасит таймер", () => {
        const { stub, window } = makeWindow();
        const message = window.setStatusBarMessage("tick", 3000);
        message.dispose();
        expect(shownMessage(stub)).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("thenable: сообщение живёт до его завершения — и успехом, и отказом", async () => {
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

    it("без таймаута сообщение висит, пока его не снимут", () => {
        const { stub, window } = makeWindow();
        window.setStatusBarMessage("sticky");
        vi.advanceTimersByTime(60_000);
        expect(shownMessage(stub)).toBe("sticky");
    });
});
