import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { registerDefaultLinkProvider } from "../../../../editor/contrib/links/browser/defaultLinkProvider.ts";
import { getLinks, resolveLinkTarget } from "../../../../editor/contrib/links/browser/getLinks.ts";

// The whole path of `registerDocumentLinkProvider`: an extension in the subprocess → the core's registry → `getLinks`
// merged with the built-in detector → `resolveDocumentLink` back in the subprocess.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.providesDocumentLinks", "providesDocumentLinks.cjs");

describe("ExtensionHost — document link providers (subprocess)", () => {
    it("a link without a target is resolved by the provider; the provider's link beats the built-in one", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "// TODO\n// https://built.in/x http://only.builtin/y\n" },
            languageService: TS_LANGUAGE_SERVICE,
            extensions: [FIXTURE],
        });
        try {
            const editor = harness.group.getActiveEditor();
            if (editor === null) throw new Error("no active editor");
            const registry = harness.languageFeatures.documentLinkProvider;
            registerDefaultLinkProvider(harness.languageFeatures);
            // The built-in one is there from the start, so wait for the second.
            await waitUntil("the provider", () => registry.ordered(editor).length === 2);

            const document = editor.viewState.document;
            const links = await getLinks(
                registry,
                editor,
                {
                    uri: editor.uri.toString(),
                    languageId: editor.languageId,
                    versionId: document.versionId,
                    document,
                },
                CancellationTokenNone,
            );

            expect(links.map((link) => [link.range, link.url])).toEqual([
                [createRange(0, 3, 0, 7), undefined],
                [createRange(1, 3, 1, 21), "https://provider.example/won"],
                [createRange(1, 22, 1, 43), "http://only.builtin/y"],
            ]);
            await expect(resolveLinkTarget(links[0], CancellationTokenNone)).resolves.toBe(
                "https://provider.example/resolved#0",
            );
        } finally {
            await harness.dispose();
        }
    });
});
