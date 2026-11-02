import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    formatDocumentFor,
    type IExtensionHarness,
    provideCompletions,
    provideDefinitions,
    provideDocumentSymbols,
    provideHovers,
    provideRename,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import {
    type IInstalledYaml,
    installYaml,
    PERSON_SCHEMA,
    YAML_ID,
    YAML_LANGUAGE_SERVICE,
    YAML_SETTINGS,
} from "../../../../../TestUtils/yamlFixture.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { CompletionTriggerKind } from "../../../../editor/common/languages/iCompletionSource.ts";
import { DEFAULT_CODE_LENS_OPTIONS } from "../../../../editor/contrib/codelens/browser/codeLensController.ts";
import { FormatOnTypeController } from "../../../../editor/contrib/format/browser/formatOnType.ts";
import { getLinks } from "../../../../editor/contrib/links/browser/getLinks.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";
import { stripMarkdown } from "../../../contrib/hover/browser/hoverService.ts";

// The stock YAML extension from the marketplace: its server answers through every provider it registers. The schema
// lies next to the document, so the suite needs the network only for the vsix itself.

let installed: IInstalledYaml;

const PERSON_YAML = [
    "# yaml-language-server: $schema=./person.schema.json",
    "name: Ada",
    "role: g",
    "extra: 1",
    "",
].join("\n");

const ANCHORS_YAML = [
    "base: &base",
    "  x: 1",
    "other:",
    "  <<: *base",
    "ref:",
    '  $ref: "#/base"',
    "z:    [1,2,   3]",
    "",
].join("\n");

interface IYamlSession {
    readonly harness: IExtensionHarness;
    readonly outputLines: string[];
    markersFor(uri: string): readonly WireMarker[];
    /** Opens the file and waits for the server to publish diagnostics for it: the readiness signal. */
    open(name: string, content: string): Promise<string>;
}

async function startYaml(configuration: Readonly<Record<string, unknown>> = {}): Promise<IYamlSession> {
    const published: { resource: string; markers: readonly WireMarker[] }[] = [];
    const outputLines: string[] = [];
    const harness = await createExtensionTestHarness({
        languageService: YAML_LANGUAGE_SERVICE,
        activateEvents: [],
        configuration: { ...YAML_SETTINGS, ...configuration },
        diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
        outputSink: {
            append: (_channel, _label, _level, value) => outputLines.push(value),
            show: () => undefined,
        },
        extensions: [installed.registration],
    });
    harness.writeFile("person.schema.json", PERSON_SCHEMA);
    const markersFor = (uri: string): readonly WireMarker[] =>
        published.filter((p) => p.resource === uri).at(-1)?.markers ?? [];
    const open = async (name: string, content: string): Promise<string> => {
        const file = harness.writeFile(name, content);
        harness.group.openFile(file);
        await harness.host.activateByEvent("onLanguage:yaml");
        const uri = Uri.file(file).toString();
        await until(`diagnostics for ${name}`, () =>
            Promise.resolve(published.some((p) => p.resource === uri) ? true : null),
        );
        return uri;
    };
    return { harness, outputLines, markersFor, open };
}

function at(harness: IExtensionHarness, uri: string, line: number, character: number) {
    return { uri, languageId: "yaml", versionId: documentVersion(harness, uri), line, character };
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock redhat.vscode-yaml (YAML language server)", () => {
    beforeAll(async () => {
        installed = await installYaml();
        expect(installed.registration.id).toBe(YAML_ID);
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "a modeline schema: validation, enum completion, hover text and the schema lens on the frame",
        { timeout: 240_000 },
        async () => {
            const { harness, markersFor, open, outputLines } = await startYaml();
            try {
                const uri = await open("person.yaml", PERSON_YAML);

                const messages = markersFor(uri).map((m) => [m.message, m.range.start.line]);
                expect(messages).toContainEqual(["Property extra is not allowed.", 3]);
                expect(messages).toContainEqual([expect.stringContaining("Value is not accepted"), 2]);

                const completions = await provideCompletions(harness, {
                    ...at(harness, uri, 2, 7),
                    triggerKind: CompletionTriggerKind.Invoke,
                });
                expect(completions.items.map((item) => item.label)).toEqual(["admin", "guest"]);

                // The server's markdown starts with a heading: the popup gets the plain title.
                const hovers = await provideHovers(harness, at(harness, uri, 1, 1));
                const text = hovers.flatMap((hover) => hover.contents.map(stripMarkdown)).join("\n");
                // The `Source:` line after it is not always there (absent on the CI runner): only the start is pinned.
                expect(text.split("\n\n").slice(0, 2)).toEqual(["Person", "Full name of the person"]);

                const editor = harness.group.getActiveEditor();
                if (editor === null) throw new Error("no active editor");
                editor.setCodeLens(DEFAULT_CODE_LENS_OPTIONS);
                await waitUntil(
                    "the schema lens",
                    () => {
                        harness.app.render();
                        return harness.app.backend.screenToString().includes("person.schema.json");
                    },
                    60_000,
                );

                expect(outputLines.filter((line) => CLIENT_CRASH_PATTERNS.test(line))).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );

    it(
        "anchors and aliases: symbols, Go to Definition, rename, a `$ref` link and Format Document",
        { timeout: 240_000 },
        async () => {
            const { harness, open } = await startYaml();
            try {
                const uri = await open("anchors.yaml", ANCHORS_YAML);

                const symbols = await provideDocumentSymbols(harness, at(harness, uri, 0, 0));
                expect(symbols.map((symbol) => symbol.name)).toEqual(["base", "other", "ref", "z"]);
                expect(symbols[0].children.map((symbol) => symbol.name)).toEqual(["x"]);

                // F12 on `*base` lands on the anchored node.
                const definitions = await provideDefinitions(harness, at(harness, uri, 3, 7));
                expect(definitions.map((definition) => [definition.uri, definition.range.start])).toEqual([
                    [uri, { line: 1, character: 2 }],
                ]);

                const editor = harness.group.getActiveEditor();
                if (editor === null) throw new Error("no active editor");
                const document = editor.viewState.document;
                const links = await getLinks(
                    harness.languageFeatures.documentLinkProvider,
                    editor,
                    { uri, languageId: "yaml", versionId: document.versionId, document },
                    CancellationTokenNone,
                );
                expect(links.map((link) => [link.range, link.url])).toEqual([[createRange(5, 9, 5, 15), `${uri}#2,3`]]);

                const edits = await formatDocumentFor(harness, {
                    uri,
                    languageId: "yaml",
                    versionId: documentVersion(harness, uri),
                    tabSize: 2,
                    insertSpaces: true,
                });
                expect(edits?.map((edit) => edit.text).join("")).toContain("z: [1, 2, 3]\n");

                await expect(provideRename(harness, at(harness, uri, 3, 7), "core")).resolves.toEqual({
                    applied: true,
                });
                expect(editor.getText()).toContain("base: &core\n  x: 1\nother:\n  <<: *core\n");
            } finally {
                await harness.dispose();
            }
        },
    );

    it("on type: Enter after a key indents the next line", { timeout: 240_000 }, async () => {
        const { harness, open } = await startYaml();
        try {
            await open("typed.yaml", "obj:\n");
            const editor = harness.group.getActiveEditor();
            if (editor === null) throw new Error("no active editor");
            // The harness has no workbench services: the setting's part is tested in formatOnTypeService.test.ts.
            const controller = new FormatOnTypeController(editor, {
                providers: harness.languageFeatures.onTypeFormattingEditProvider,
                isSettingEnabled: () => true,
            });
            try {
                editor.viewState.selections = [createCursorSelection(0, 4)];
                editor.typeText("\n");
                // One indent level by the editor's tab size (4 here; 2 in the app through the `[yaml]` defaults).
                await waitUntil("the indent", () => editor.viewState.document.getLineContent(1) === "    ", 20_000);
                expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 4 });
            } finally {
                controller.dispose();
            }
        } finally {
            await harness.dispose();
        }
    });

    it(
        "the server has no inlay hints, implementations, hierarchies or linked editing",
        { timeout: 240_000 },
        async () => {
            const { harness, open } = await startYaml();
            try {
                const uri = await open("plain.yaml", "a: 1\n");
                const target = { uri: Uri.parse(uri), languageId: "yaml" };
                const features = harness.languageFeatures;
                // The providers it does register, so the absent ones are not a timing artefact.
                expect(features.documentSymbolProvider.has(target)).toBe(true);
                expect(features.codeLensProvider.has(target)).toBe(true);
                expect({
                    inlayHints: features.inlayHintsProvider.has(target),
                    implementation: features.implementationProvider.has(target),
                    callHierarchy: features.callHierarchyProvider.has(target),
                    typeHierarchy: features.typeHierarchyProvider.has(target),
                    linkedEditing: features.linkedEditingRangeProvider.has(target),
                }).toEqual({
                    inlayHints: false,
                    implementation: false,
                    callHierarchy: false,
                    typeHierarchy: false,
                    linkedEditing: false,
                });
            } finally {
                await harness.dispose();
            }
        },
    );

    it(
        "an unreachable schema URL: the document is still checked as YAML, nothing crashes",
        { timeout: 240_000 },
        async () => {
            // A dead proxy stands for no network: the server fetches schemas through `http.proxy`.
            const { harness, markersFor, open, outputLines } = await startYaml({
                http: { proxy: "http://127.0.0.1:9" },
            });
            try {
                const uri = await open(
                    "offline.yaml",
                    "# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json\nkey: 1\nkey: 2\n",
                );
                await until("the duplicate key", () =>
                    Promise.resolve(markersFor(uri).some((m) => m.message === "Map keys must be unique") ? true : null),
                );
                expect(outputLines.filter((line) => CLIENT_CRASH_PATTERNS.test(line))).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
