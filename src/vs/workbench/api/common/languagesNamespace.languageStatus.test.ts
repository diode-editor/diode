import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

// The namespace wiring: ruff writes server state into text/severity/busy on every transition and
// calls dispose on restart. The wire traffic is covered by extHostLanguageStatus.test.ts.

function makeLanguages(): ReturnType<typeof createLanguagesNamespace>["languages"] {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: makeStubRpc().rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    return createLanguagesNamespace(ctx, {
        applyEdit: () => Promise.resolve(false),
        executeCommand: () => Promise.resolve(undefined),
    }).languages;
}

describe("languages.createLanguageStatusItem", () => {
    it("creates a holder with id/selector and defaults, fields are mutable", () => {
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

    it("dispose does not throw and is repeatable", () => {
        const item = makeLanguages().createLanguageStatusItem("x", "python");
        expect(() => {
            item.dispose();
            item.dispose();
        }).not.toThrow();
    });
});
