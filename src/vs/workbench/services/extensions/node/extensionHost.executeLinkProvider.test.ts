import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { registerDefaultLinkProvider } from "../../../../editor/contrib/links/browser/defaultLinkProvider.ts";
import { ExecuteLinkProviderCommandContribution } from "../../../contrib/links/browser/executeLinkProviderCommand.ts";

// `vscode.executeLinkProvider` end to end: an extension in the subprocess runs the API command, the core's
// `_executeLinkProvider` asks the extension's provider and the built-in URL detector, resolves the first links
// back in the subprocess, and the extension gets `DocumentLink`s.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.executesLinkProvider", "executesLinkProvider.cjs");
const COMMAND = "test.executeLinkProvider";

describe("ExtensionHost — vscode.executeLinkProvider (subprocess)", () => {
    it("answers the provider's links and the detected URL, the first linkResolveCount resolved", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: {
                name: "main.ts",
                content: "import x from 'lib:one';\n// see https://built.in/x and lib:two\n",
            },
            languageService: TS_LANGUAGE_SERVICE,
            extensions: [FIXTURE],
        });
        try {
            const editor = harness.group.getActiveEditor();
            if (editor === null) throw new Error("no active editor");
            registerDefaultLinkProvider(harness.languageFeatures);
            const contribution = new ExecuteLinkProviderCommandContribution(
                harness.commandRegistry,
                harness.group,
                harness.languageFeatures,
            );
            await waitUntil("the extension's command", () => harness.commandRegistry.has(COMMAND));
            const uri = editor.uri.toString();

            await expect(harness.commandRegistry.execute(COMMAND, uri, 1)).resolves.toEqual([
                { isDocumentLink: true, range: [0, 15, 0, 22], target: "https://lib.example/one", tooltip: "one" },
                { isDocumentLink: true, range: [1, 7, 1, 25], target: "https://built.in/x" },
                { isDocumentLink: true, range: [1, 30, 1, 37], tooltip: "two" },
            ]);
            await expect(
                harness.commandRegistry.execute(COMMAND, Uri.file(harness.writeFile("closed.ts", "lib:x")).toString()),
            ).resolves.toEqual([]);
            contribution.dispose();
        } finally {
            await harness.dispose();
        }
    });
});
