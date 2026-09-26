import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { ColorThemeKind } from "./vscodeTypes.ts";
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
    };
    return { stub, window: createWindowNamespace(ctx) };
}

describe("WindowNamespace — window.activeColorTheme", () => {
    it("до первого window.themeChanged тема — тёмная (дефолт VS Code), а не undefined", () => {
        const { window } = makeCtx();
        expect(window.activeColorTheme.kind).toBe(ColorThemeKind.Dark);
    });

    it("window.themeChanged обновляет activeColorTheme и стреляет событием", () => {
        const { stub, window } = makeCtx();
        const seen: vscode.ColorThemeKind[] = [];
        window.onDidChangeActiveColorTheme((theme) => seen.push(theme.kind));

        stub.fire("window.themeChanged", { kind: 1 });
        expect(window.activeColorTheme.kind).toBe(ColorThemeKind.Light);
        expect(seen).toEqual([ColorThemeKind.Light]);

        stub.fire("window.themeChanged", { kind: 4 });
        expect(window.activeColorTheme.kind).toBe(ColorThemeKind.HighContrastLight);
        expect(seen).toEqual([ColorThemeKind.Light, ColorThemeKind.HighContrastLight]);
    });

    it("событие стреляет и когда вид темы не поменялся (Dark+ → Abyss — обе тёмные)", () => {
        const { stub, window } = makeCtx();
        let fired = 0;
        window.onDidChangeActiveColorTheme(() => fired++);
        stub.fire("window.themeChanged", { kind: 2 });
        stub.fire("window.themeChanged", { kind: 2 });
        expect(fired).toBe(2);
        expect(window.activeColorTheme.kind).toBe(ColorThemeKind.Dark);
    });

    it("мусорная форма сообщения не меняет тему и не стреляет событием", () => {
        const { stub, window } = makeCtx();
        let fired = 0;
        window.onDidChangeActiveColorTheme(() => fired++);
        stub.fire("window.themeChanged", { kind: 1 });
        expect(window.activeColorTheme.kind).toBe(ColorThemeKind.Light);

        stub.fire("window.themeChanged", { kind: 9 });
        stub.fire("window.themeChanged", { kind: "dark" });
        stub.fire("window.themeChanged", null);
        expect(window.activeColorTheme.kind).toBe(ColorThemeKind.Light);
        expect(fired).toBe(1);
    });

    it("подписка снимается dispose'ом, thisArgs и массив disposables поддержаны", () => {
        const { stub, window } = makeCtx();
        const host = { seen: [] as number[] };
        const bucket: vscode.Disposable[] = [];
        function listener(this: typeof host, theme: vscode.ColorTheme): void {
            this.seen.push(theme.kind);
        }
        window.onDidChangeActiveColorTheme(listener, host, bucket);
        expect(bucket).toHaveLength(1);

        stub.fire("window.themeChanged", { kind: 3 });
        expect(host.seen).toEqual([ColorThemeKind.HighContrast]);

        bucket[0].dispose();
        stub.fire("window.themeChanged", { kind: 1 });
        expect(host.seen).toEqual([ColorThemeKind.HighContrast]);
    });
});
