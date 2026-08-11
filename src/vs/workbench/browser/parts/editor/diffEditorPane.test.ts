import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";

import { DiffEditorPane, type IDiffEditorPaneInput } from "./diffEditorPane.ts";

function makeInput(overrides: Partial<IDiffEditorPaneInput> = {}): IDiffEditorPaneInput {
    return {
        uri: Uri.parse("vexx-diff:/a.txt?HEAD"),
        label: "a.txt ↔ HEAD",
        originalLabel: "HEAD",
        modifiedLabel: "a.txt",
        originalText: "alpha\nbeta\n",
        modifiedText: "alpha\ngamma\n",
        languageId: "plaintext",
        ...overrides,
    };
}

describe("DiffEditorPane — ресурсы сторон", () => {
    it("сторона без ресурса (HEAD-версия) — во вкладке uri стороны null", () => {
        // Ресурсы сторон опциональны: снимок HEAD не существует как файл, и
        // расширение через TabInputTextDiff видит дифф без исходных uri.
        const pane = new DiffEditorPane(new TokenizationRegistry(), NULL_TOKEN_STYLE_RESOLVER, makeInput());

        expect(pane.originalUri).toBeNull();
        expect(pane.modifiedUri).toBeNull();
        pane.dispose();
    });

    it("переданные ресурсы сторон доезжают до полей вкладки", () => {
        const original = Uri.file("/tmp/left.txt");
        const modified = Uri.file("/tmp/right.txt");
        const pane = new DiffEditorPane(
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            makeInput({ originalUri: original, modifiedUri: modified }),
        );

        expect(pane.originalUri?.toString()).toBe(original.toString());
        expect(pane.modifiedUri?.toString()).toBe(modified.toString());
        pane.dispose();
    });
});
