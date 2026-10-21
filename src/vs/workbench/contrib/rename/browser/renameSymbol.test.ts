import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    ICoreRenameLocation,
    ICoreRenameResult,
    IRenameRequest,
    RenameProvider,
} from "../../../../editor/common/languages/iRenameSource.ts";

import { prepareRename, renameSymbol } from "./renameSymbol.ts";

const TS = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const REQUEST: IRenameRequest = {
    uri: TS.uri.toString(),
    languageId: "typescript",
    versionId: 1,
    line: 0,
    character: 8,
};

function provider(impl: Partial<RenameProvider>): RenameProvider {
    return {
        prepareRename: impl.prepareRename ?? ((): Promise<null> => Promise.resolve(null)),
        provideRenameEdits:
            impl.provideRenameEdits ?? ((): Promise<ICoreRenameResult> => Promise.resolve({ applied: false })),
    };
}

const named = (value: string): Promise<ICoreRenameLocation> => Promise.resolve({ kind: "name", name: value });

describe("prepareRename", () => {
    it("the name comes from the FIRST provider that has something to say", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const second = vi.fn(() => named("second"));
        // `ordered` puts newer ones first at equal score, so the provider
        // registered last is asked "first".
        registry.register({ language: "typescript" }, provider({ prepareRename: second }));
        registry.register({ language: "typescript" }, provider({ prepareRename: () => named("first") }));

        expect(await prepareRename(registry, TS, REQUEST)).toEqual({ name: "first" });
        expect(second).not.toHaveBeenCalled();
    });

    it("a provider with no answer is skipped — the next one is asked", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        registry.register({ language: "typescript" }, provider({ prepareRename: () => named("second") }));
        registry.register({ language: "typescript" }, provider({}));

        expect(await prepareRename(registry, TS, REQUEST)).toEqual({ name: "second" });
    });

    it("provider refusal stops the iteration and carries the reason", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const second = vi.fn(() => named("second"));
        registry.register({ language: "typescript" }, provider({ prepareRename: second }));
        registry.register(
            { language: "typescript" },
            provider({ prepareRename: () => Promise.resolve({ kind: "reject", reason: "no identifier" }) }),
        );

        expect(await prepareRename(registry, TS, REQUEST)).toEqual({ name: null, rejectReason: "no identifier" });
        expect(second).not.toHaveBeenCalled();
    });

    it("a failing provider does not break the iteration: its answer is 'nothing to say'", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        registry.register({ language: "typescript" }, provider({ prepareRename: () => named("second") }));
        registry.register(
            { language: "typescript" },
            provider({ prepareRename: () => Promise.reject(new Error("rpc died")) }),
        );

        expect(await prepareRename(registry, TS, REQUEST)).toEqual({ name: "second" });
    });

    it("a provider of another language is not asked, empty registry — no name", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const alien = vi.fn(() => named("alien"));
        registry.register({ language: "python" }, provider({ prepareRename: alien }));

        expect(await prepareRename(registry, TS, REQUEST)).toEqual({ name: null });
        expect(alien).not.toHaveBeenCalled();
    });
});

describe("renameSymbol", () => {
    it("the FIRST provider that returns edits renames; the new name gets through", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const second = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        const first = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        registry.register({ language: "typescript" }, provider({ provideRenameEdits: second }));
        registry.register({ language: "typescript" }, provider({ provideRenameEdits: first }));

        expect(await renameSymbol(registry, TS, REQUEST, "renamed")).toEqual({ applied: true });
        expect(first).toHaveBeenCalledWith(REQUEST, "renamed");
        expect(second).not.toHaveBeenCalled();
    });

    it("a provider without edits is skipped — the next one is asked", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        registry.register(
            { language: "typescript" },
            provider({ provideRenameEdits: () => Promise.resolve({ applied: true }) }),
        );
        registry.register({ language: "typescript" }, provider({}));

        expect(await renameSymbol(registry, TS, REQUEST, "renamed")).toEqual({ applied: true });
    });

    it("provider refusal stops the iteration: the message reaches the user", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const second = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        registry.register({ language: "typescript" }, provider({ provideRenameEdits: second }));
        registry.register(
            { language: "typescript" },
            provider({ provideRenameEdits: () => Promise.resolve({ applied: false, error: "Invalid name" }) }),
        );

        expect(await renameSymbol(registry, TS, REQUEST, "class")).toEqual({
            applied: false,
            error: "Invalid name",
        });
        expect(second).not.toHaveBeenCalled();
    });

    it("failing provider — refusal with a generic message, iteration stopped", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const second = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        registry.register({ language: "typescript" }, provider({ provideRenameEdits: second }));
        registry.register(
            { language: "typescript" },
            provider({ provideRenameEdits: () => Promise.reject(new Error("rpc died")) }),
        );

        expect(await renameSymbol(registry, TS, REQUEST, "renamed")).toEqual({
            applied: false,
            error: "Rename failed",
        });
        expect(second).not.toHaveBeenCalled();
    });

    it("no provider for the document — applied: false WITHOUT a message", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const alien = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        registry.register({ language: "python" }, provider({ provideRenameEdits: alien }));

        expect(await renameSymbol(registry, TS, REQUEST, "renamed")).toEqual({ applied: false });
        expect(alien).not.toHaveBeenCalled();
    });
});
