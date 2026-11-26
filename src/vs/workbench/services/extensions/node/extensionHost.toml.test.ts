import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    formatDocumentFor,
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

async function openSample() {
    const harness = await createExtensionTestHarness({
        languageService: TOML_LANGUAGE_SERVICE,
        activateEvents: [],
        extensions: [installed.registration],
        configuration: {
            "evenBetterToml.schema.links": true,
            "evenBetterToml.formatter.indentEntries": true,
        },
    });
    harness.writeFile("schema.json", TOML_SCHEMA);
    const file = harness.writeFile("sample.toml", TOML_WITH_SCHEMA);
    harness.group.openFile(file);
    await harness.host.activateByEvent("onLanguage:toml");
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    await waitUntil("the taplo providers", () => harness.languageFeatures.documentSymbolProvider.has(editor), 60_000);
    const uri = Uri.file(file).toString();
    return { harness, editor, uri, languageId: "toml", versionId: documentVersion(harness, uri) };
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock Even Better TOML from the marketplace", () => {
    beforeAll(async () => {
        installed = await installToml();
    }, 180_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "symbols, format with evenBetterToml.formatter.*, hover, completion, links, rename, no providers the server lacks",
        { timeout: 180_000 },
        async () => {
            const { harness, editor, ...request } = await openSample();
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

                const features = harness.languageFeatures;
                const absent = {
                    inlayHints: features.inlayHintsProvider,
                    codeLens: features.codeLensProvider,
                    implementation: features.implementationProvider,
                    callHierarchy: features.callHierarchyProvider,
                    typeHierarchy: features.typeHierarchyProvider,
                    linkedEditing: features.linkedEditingRangeProvider,
                    onTypeFormatting: features.onTypeFormattingEditProvider,
                };
                expect(Object.entries(absent).filter(([, registry]) => registry.has(editor))).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
