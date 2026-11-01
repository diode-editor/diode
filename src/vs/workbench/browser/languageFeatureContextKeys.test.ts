import { describe, expect, it } from "vitest";

import { Uri } from "../../base/common/uri.ts";
import { LanguageFeaturesService } from "../../editor/common/services/languageFeaturesService.ts";
import { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";

import { LanguageFeatureContextKeys } from "./languageFeatureContextKeys.ts";

function editorStub(options: { languageId?: string; selection?: { anchorCharacter: number } } = {}): unknown {
    const anchorCharacter = options.selection?.anchorCharacter ?? 0;
    return {
        uri: Uri.file("/w/a.ts"),
        languageId: options.languageId ?? "typescript",
        viewState: {
            selections: [{ anchor: { line: 0, character: anchorCharacter }, active: { line: 0, character: 0 } }],
        },
    };
}

function makeKeys(editor: unknown): {
    keys: ContextKeyService;
    features: LanguageFeaturesService;
    update: () => void;
} {
    const keys = new ContextKeyService();
    const features = new LanguageFeaturesService();
    const group = { getActiveEditor: () => editor } as unknown as IEditorService;
    const contributor = new LanguageFeatureContextKeys(group, features, keys);
    return {
        keys,
        features,
        update: () => {
            contributor.updateContextKeys(keys);
        },
    };
}

describe("LanguageFeatureContextKeys", () => {
    it("without providers all keys are false, so menus do not offer what does not work", () => {
        const { keys, update } = makeKeys(editorStub());

        update();

        expect(keys.evaluate("editorHasDefinitionProvider")).toBe(false);
        expect(keys.evaluate("editorHasImplementationProvider")).toBe(false);
        expect(keys.evaluate("editorHasTypeDefinitionProvider")).toBe(false);
        expect(keys.evaluate("editorHasDeclarationProvider")).toBe(false);
        expect(keys.evaluate("editorHasReferenceProvider")).toBe(false);
        expect(keys.evaluate("editorHasRenameProvider")).toBe(false);
        expect(keys.evaluate("editorHasCodeActionsProvider")).toBe(false);
        expect(keys.evaluate("editorHasDocumentFormattingProvider")).toBe(false);
        expect(keys.evaluate("editorHasDocumentSelectionFormattingProvider")).toBe(false);
    });

    it.each([
        ["definitionProvider", "editorHasDefinitionProvider"],
        ["implementationProvider", "editorHasImplementationProvider"],
        ["typeDefinitionProvider", "editorHasTypeDefinitionProvider"],
        ["declarationProvider", "editorHasDeclarationProvider"],
        ["referenceProvider", "editorHasReferenceProvider"],
        ["renameProvider", "editorHasRenameProvider"],
        ["codeActionProvider", "editorHasCodeActionsProvider"],
        ["documentFormattingEditProvider", "editorHasDocumentFormattingProvider"],
        ["documentRangeFormattingEditProvider", "editorHasDocumentSelectionFormattingProvider"],
    ] as const)("%s: registering and disposing updates %s with nothing else happening", (feature, key) => {
        const { keys, features } = makeKeys(editorStub());

        const registration = features[feature].register({ language: "typescript" }, {} as never);
        expect(keys.evaluate(key)).toBe(true);

        registration.dispose();
        expect(keys.evaluate(key)).toBe(false);
    });

    it("each key is raised by its own registry and only by it", () => {
        const { keys, features, update } = makeKeys(editorStub());
        const noop = {} as never;

        features.renameProvider.register({ language: "typescript" }, noop);
        update();
        expect(keys.evaluate("editorHasRenameProvider")).toBe(true);
        expect(keys.evaluate("editorHasDefinitionProvider")).toBe(false);

        features.definitionProvider.register({ language: "typescript" }, noop);
        update();
        expect(keys.evaluate("editorHasImplementationProvider")).toBe(false);

        features.implementationProvider.register({ language: "typescript" }, noop);
        features.referenceProvider.register({ language: "typescript" }, noop);
        features.codeActionProvider.register({ language: "typescript" }, noop);
        features.documentFormattingEditProvider.register({ language: "typescript" }, noop);
        features.documentRangeFormattingEditProvider.register({ language: "typescript" }, noop);
        features.inlayHintsProvider.register({ language: "typescript" }, {} as never);
        update();
        expect(keys.evaluate("editorHasInlayHintsProvider")).toBe(true);
        expect(keys.evaluate("editorHasDefinitionProvider")).toBe(true);
        expect(keys.evaluate("editorHasImplementationProvider")).toBe(true);
        expect(keys.evaluate("editorHasReferenceProvider")).toBe(true);
        expect(keys.evaluate("editorHasCodeActionsProvider")).toBe(true);
        expect(keys.evaluate("editorHasDocumentFormattingProvider")).toBe(true);
        expect(keys.evaluate("editorHasDocumentSelectionFormattingProvider")).toBe(true);
    });

    it("a provider for another language does not raise the key", () => {
        const { keys, features, update } = makeKeys(editorStub({ languageId: "markdown" }));
        features.renameProvider.register({ language: "typescript" }, {} as never);

        update();

        expect(keys.evaluate("editorHasRenameProvider")).toBe(false);
    });

    it("without an active editor the keys reset instead of sticking from the previous document", () => {
        const { keys, features, update } = makeKeys(editorStub());
        features.renameProvider.register({ language: "typescript" }, {} as never);
        update();
        expect(keys.evaluate("editorHasRenameProvider")).toBe(true);

        const closed = makeKeys(null);
        closed.features.renameProvider.register({ language: "typescript" }, {} as never);
        closed.update();

        expect(closed.keys.evaluate("editorHasRenameProvider")).toBe(false);
        expect(closed.keys.evaluate("editorHasSelection")).toBe(false);
    });

    it("editorHasSelection only with a non-empty selection", () => {
        const empty = makeKeys(editorStub());
        empty.update();
        expect(empty.keys.evaluate("editorHasSelection")).toBe(false);

        const selected = makeKeys(editorStub({ selection: { anchorCharacter: 4 } }));
        selected.update();
        expect(selected.keys.evaluate("editorHasSelection")).toBe(true);
    });
});
