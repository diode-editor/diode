import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    formatDocumentFor,
    type IExtensionHarness,
    provideCompletions,
    provideDocumentSymbols,
    provideHovers,
    provideRename,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import {
    type IInstalledToml,
    installToml,
    TOML_LANGUAGE_SERVICE,
    TOML_SCHEMA,
    TOML_WITH_SCHEMA,
} from "../../../../../TestUtils/tomlFixture.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { getLinks } from "../../../../editor/contrib/links/browser/getLinks.ts";

let installed: IInstalledToml;

async function openSample(
    configuration: Readonly<Record<string, unknown>> = {},
): Promise<{ harness: IExtensionHarness; uri: string; versionId: number; languageId: string }> {
    const harness = await createExtensionTestHarness({
        languageService: TOML_LANGUAGE_SERVICE,
        activateEvents: [],
        extensions: [installed.registration],
        configuration,
    });
    harness.writeFile("schema.json", TOML_SCHEMA);
    const file = harness.writeFile("sample.toml", TOML_WITH_SCHEMA);
    harness.group.openFile(file);
    await harness.host.activateByEvent("onLanguage:toml");
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    await waitUntil("the taplo providers", () => harness.languageFeatures.documentSymbolProvider.has(editor), 60_000);
    const uri = Uri.file(file).toString();
    return { harness, uri, languageId: "toml", versionId: documentVersion(harness, uri) };
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock Even Better TOML from the marketplace", () => {
    beforeAll(async () => {
        installed = await installToml();
    }, 180_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "symbols, format with evenBetterToml.formatter.*, hover, completion, links and rename",
        { timeout: 180_000 },
        async () => {
            const { harness, ...request } = await openSample({
                "evenBetterToml.schema.links": true,
                "evenBetterToml.formatter.indentEntries": true,
            });
            try {
                const symbols = await provideDocumentSymbols(harness, request);
                expect(symbols.map((symbol) => [symbol.name, symbol.children.map((child) => child.name)])).toEqual([
                    ["package", ["name"]],
                ]);

                const edits = await formatDocumentFor(harness, { ...request, tabSize: 2, insertSpaces: true });
                expect(edits?.map((edit) => edit.text).join("")).toContain('  name = "demo"');

                const position = { ...request, line: 2, character: 1 };
                const hovers = await until(
                    "the hover from the local schema",
                    async () => {
                        const found = await provideHovers(harness, position);
                        return JSON.stringify(found).includes("The package name from the schema") ? found : null;
                    },
                    30_000,
                );
                expect(hovers).toHaveLength(1);

                const completions = await provideCompletions(harness, { ...request, line: 3, character: 0 });
                expect(JSON.stringify(completions)).toContain("homepage");

                const editor = harness.group.getActiveEditor();
                if (editor === null) throw new Error("no active editor");
                const links = await getLinks(
                    harness.languageFeatures.documentLinkProvider,
                    editor,
                    { ...request, document: editor.viewState.document },
                    CancellationTokenNone,
                );
                expect(links.map((link) => link.url)).toContain("https://example.com/package-name");

                const rename = await provideRename(harness, position, "title");
                expect(rename).toMatchObject({ applied: true });
                expect(editor.getText()).toContain('title   =   "demo"');
            } finally {
                await harness.dispose();
            }
        },
    );

    it("features the server does not have stay unregistered", { timeout: 120_000 }, async () => {
        const { harness } = await openSample();
        try {
            const editor = harness.group.getActiveEditor();
            if (editor === null) throw new Error("no active editor");
            const features = harness.languageFeatures;
            expect({
                inlayHints: features.inlayHintsProvider.has(editor),
                codeLens: features.codeLensProvider.has(editor),
                implementation: features.implementationProvider.has(editor),
                callHierarchy: features.callHierarchyProvider.has(editor),
                typeHierarchy: features.typeHierarchyProvider.has(editor),
                linkedEditing: features.linkedEditingRangeProvider.has(editor),
                onTypeFormatting: features.onTypeFormattingEditProvider.has(editor),
            }).toEqual({
                inlayHints: false,
                codeLens: false,
                implementation: false,
                callHierarchy: false,
                typeHierarchy: false,
                linkedEditing: false,
                onTypeFormatting: false,
            });
        } finally {
            await harness.dispose();
        }
    });
});
