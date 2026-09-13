import { describe, expect, it } from "vitest";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

// Наивный language status item: в UI не проецируется, но обязан быть честным
// держателем полей — ruff пишет в text/severity/busy состояние сервера при
// каждом его переходе и зовёт dispose при рестарте.

function makeLanguages(): ReturnType<typeof createLanguagesNamespace>["languages"] {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: makeStubRpc().rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    return createLanguagesNamespace(ctx, {
        applyEdit: () => Promise.resolve(false),
        executeCommand: () => Promise.resolve(undefined),
    }).languages;
}

describe("languages.createLanguageStatusItem", () => {
    it("создаёт держатель с id/selector и дефолтами, поля мутируемы", () => {
        const languages = makeLanguages();
        const item = languages.createLanguageStatusItem("ruff.status", { language: "python" });

        expect(item.id).toBe("ruff.status");
        expect(item.selector).toEqual({ language: "python" });
        expect(item.text).toBe("");
        expect(item.busy).toBe(false);
        expect(item.severity).toBe(0);

        item.text = "Ruff";
        item.busy = true;
        item.severity = 2;
        expect(item.text).toBe("Ruff");
        expect(item.busy).toBe(true);
        expect(item.severity).toBe(2);
    });

    it("dispose не бросает и повторяем", () => {
        const item = makeLanguages().createLanguageStatusItem("x", "python");
        expect(() => {
            item.dispose();
            item.dispose();
        }).not.toThrow();
    });
});
