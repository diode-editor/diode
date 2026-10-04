import { describe, expect, it } from "vitest";

import { Uri } from "../../base/common/uri.ts";
import { LanguageFeaturesService } from "../../editor/common/services/languageFeaturesService.ts";
import { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";

import { LanguageFeatureContextKeys } from "./languageFeatureContextKeys.ts";

/** Активный редактор: реестру нужны только ресурс, язык и выделение. */
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
    const group = { getActiveEditor: () => editor } as unknown as EditorService;
    const contributor = new LanguageFeatureContextKeys(group, features);
    return {
        keys,
        features,
        update: () => {
            contributor.updateContextKeys(keys);
        },
    };
}

describe("LanguageFeatureContextKeys", () => {
    it("без провайдеров все ключи ложны — меню не обещает нерабочее", () => {
        const { keys, update } = makeKeys(editorStub());

        update();

        expect(keys.evaluate("editorHasDefinitionProvider")).toBe(false);
        expect(keys.evaluate("editorHasReferenceProvider")).toBe(false);
        expect(keys.evaluate("editorHasRenameProvider")).toBe(false);
        expect(keys.evaluate("editorHasCodeActionsProvider")).toBe(false);
        expect(keys.evaluate("editorHasDocumentFormattingProvider")).toBe(false);
        expect(keys.evaluate("editorHasDocumentSelectionFormattingProvider")).toBe(false);
    });

    it("каждый ключ поднимает свой реестр и только его", () => {
        const { keys, features, update } = makeKeys(editorStub());
        const noop = {} as never;

        features.renameProvider.register({ language: "typescript" }, noop);
        update();
        expect(keys.evaluate("editorHasRenameProvider")).toBe(true);
        expect(keys.evaluate("editorHasDefinitionProvider")).toBe(false);

        features.definitionProvider.register({ language: "typescript" }, noop);
        features.referenceProvider.register({ language: "typescript" }, noop);
        features.codeActionProvider.register({ language: "typescript" }, noop);
        features.documentFormattingEditProvider.register({ language: "typescript" }, noop);
        features.documentRangeFormattingEditProvider.register({ language: "typescript" }, noop);
        update();
        expect(keys.evaluate("editorHasDefinitionProvider")).toBe(true);
        expect(keys.evaluate("editorHasReferenceProvider")).toBe(true);
        expect(keys.evaluate("editorHasCodeActionsProvider")).toBe(true);
        expect(keys.evaluate("editorHasDocumentFormattingProvider")).toBe(true);
        expect(keys.evaluate("editorHasDocumentSelectionFormattingProvider")).toBe(true);
    });

    it("провайдер чужого языка ключ не поднимает", () => {
        const { keys, features, update } = makeKeys(editorStub({ languageId: "markdown" }));
        features.renameProvider.register({ language: "typescript" }, {} as never);

        update();

        expect(keys.evaluate("editorHasRenameProvider")).toBe(false);
    });

    it("без активного редактора ключи сбрасываются, а не залипают от прошлого документа", () => {
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

    it("editorHasSelection — только при непустом выделении", () => {
        const empty = makeKeys(editorStub());
        empty.update();
        expect(empty.keys.evaluate("editorHasSelection")).toBe(false);

        const selected = makeKeys(editorStub({ selection: { anchorCharacter: 4 } }));
        selected.update();
        expect(selected.keys.evaluate("editorHasSelection")).toBe(true);
    });
});
