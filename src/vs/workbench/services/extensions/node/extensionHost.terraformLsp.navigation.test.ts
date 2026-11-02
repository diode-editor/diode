import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideDeclarations,
    provideDefinitions,
    provideDocumentSymbols,
    provideHovers,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import {
    type IInstalledTerraform,
    installTerraform,
    TF_LANGUAGE_SERVICE,
    TF_SAMPLE_DIR,
} from "../../../../../TestUtils/terraformFixture.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IDefinitionRequest } from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { ILink } from "../../../../editor/common/languages/iLinkSource.ts";
import type { ICoreWorkspaceSymbol } from "../../../../editor/common/languages/iWorkspaceSymbolSource.ts";
import { getLinks } from "../../../../editor/contrib/links/browser/getLinks.ts";
import { flattenDocumentSymbols } from "../../../contrib/quickaccess/browser/gotoSymbolQuickAccessProvider.ts";
import { getWorkspaceSymbols } from "../../../contrib/quickaccess/browser/workspaceSymbolsQuickAccessProvider.ts";

// The features of the navigation wave that terraform-ls 0.39 has, and a matrix of those it has not: a server update
// that adds one fails here. Opening a link, down to the toast of a session without a browser, is in the
// `terraform-symbols` scenario.

const TIMEOUT = { timeout: 240_000 };

let installed: IInstalledTerraform;

type TfEditor = NonNullable<ReturnType<IExtensionHarness["group"]["getActiveEditor"]>>;

interface ITfSession {
    readonly harness: IExtensionHarness;
    readonly editor: TfEditor;
    /** The position of `needle` in `main.tf`, `offset` characters into it. */
    at(needle: string, offset?: number): IDefinitionRequest;
}

/** `beforeServer` runs before the activation: the walker and the settings of the client are read at its start. */
async function withMainTf(
    run: (session: ITfSession) => Promise<void>,
    beforeServer?: (harness: IExtensionHarness) => Promise<void> | void,
): Promise<void> {
    const output: string[] = [];
    const harness = await createExtensionTestHarness({
        languageService: TF_LANGUAGE_SERVICE,
        activateEvents: [],
        outputSink: { append: (_channel, _label, _level, value) => output.push(value), show: () => undefined },
        extensions: [installed.registration],
    });
    try {
        fs.cpSync(TF_SAMPLE_DIR, harness.tmpDir, { recursive: true });
        await beforeServer?.(harness);
        const mainPath = path.join(harness.tmpDir, "main.tf");
        harness.group.openFile(mainPath);
        const editor = harness.group.getActiveEditor();
        if (editor === null) throw new Error("no active editor");
        await harness.host.activateByEvent("onLanguage:terraform");
        const uri = Uri.file(mainPath).toString();
        const at = (needle: string, offset = 0): IDefinitionRequest => {
            const lines = editor.getText().split("\n");
            const line = lines.findIndex((text) => text.includes(needle));
            if (line < 0) throw new Error(`"${needle}" is not in main.tf`);
            return {
                uri,
                languageId: "terraform",
                versionId: documentVersion(harness, uri),
                line,
                character: lines[line].indexOf(needle) + offset,
            };
        };
        // The hover knows the type from the declaration: the module is indexed, empty answers below are the server's.
        await until("the hover over var.region", async () => {
            const hovers = await provideHovers(harness, at("var.region", 6));
            return hovers
                .flatMap((hover) => hover.contents)
                .join("\n")
                .includes("string")
                ? true
                : null;
        });
        await run({ harness, editor, at });
        expect(output.filter((line) => CLIENT_CRASH_PATTERNS.test(line))).toEqual([]);
    } finally {
        await harness.dispose();
    }
}

function askLinks({ harness, editor }: ITfSession): Promise<readonly ILink[]> {
    const document = editor.viewState.document;
    return getLinks(
        harness.languageFeatures.documentLinkProvider,
        editor,
        { uri: editor.uri.toString(), languageId: editor.languageId, versionId: document.versionId, document },
        CancellationTokenNone,
    );
}

/** Indexing runs after the first answers: asks until the symbol is there. */
function askWorkspaceSymbols(harness: IExtensionHarness, query: string): Promise<readonly ICoreWorkspaceSymbol[]> {
    return until(`the workspace symbol ${query}`, async () => {
        const items = await getWorkspaceSymbols(
            harness.languageFeatures.workspaceSymbolProvider,
            query,
            CancellationTokenNone,
        );
        return items.length > 0 ? items.map((item) => item.symbol) : null;
    });
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — navigation and symbols of stock hashicorp.terraform", () => {
    beforeAll(async () => {
        installed = await installTerraform();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("Declaration on var.region goes to the `variable` block, and answers exactly as Definition", TIMEOUT, () =>
        withMainTf(async ({ harness, at }) => {
            const request = at("var.region", 6);
            const block = at('variable "region"');

            const declarations = await provideDeclarations(harness, request);
            expect(declarations.map((target) => [target.uri, target.range.start])).toEqual([
                [request.uri, { line: block.line, character: 0 }],
            ]);
            // terraform-ls serves both requests with one handler. The difference between them would be a new behavior.
            await expect(provideDefinitions(harness, request)).resolves.toEqual(declarations);
        }),
    );

    it("links: the label of a `provider` block goes to the registry; a `resource` label has none", TIMEOUT, () =>
        withMainTf(async (session) => {
            const links = await until("the provider link", async () => {
                const answer = await askLinks(session);
                return answer.length > 0 ? answer : null;
            });

            const label = session.at('provider "aws"', "provider ".length);
            expect(links).toHaveLength(1);
            expect(links[0].range).toEqual({
                start: { line: label.line, character: label.character },
                end: { line: label.line, character: label.character + '"aws"'.length },
            });
            expect(links[0].url).toMatch(
                /^https:\/\/registry\.terraform\.io\/providers\/hashicorp\/aws\/[^/]+\/docs\?/,
            );
            expect(links[0].tooltip).toBe("hashicorp/aws Documentation");
        }),
    );

    it("`@`: the blocks of the file, an attribute names its block as the container", TIMEOUT, () =>
        withMainTf(async ({ harness, at }) => {
            const symbols = await provideDocumentSymbols(harness, at("terraform {"));

            expect(symbols.map((symbol) => symbol.name)).toEqual([
                "terraform",
                'variable "region"',
                'provider "aws"',
                'resource "aws_instance" "web"',
            ]);
            expect(flattenDocumentSymbols(symbols)).toContainEqual(
                expect.objectContaining({ name: "default", containerName: 'variable "region"' }),
            );
        }),
    );

    it("`@` in the file with a module block lists it, the variable and the resource", TIMEOUT, () =>
        withMainTf(async ({ harness }) => {
            const networkPath = path.join(harness.tmpDir, "network.tf");
            harness.group.openFile(networkPath);
            const uri = Uri.file(networkPath).toString();

            const symbols = await until("the symbols of network.tf", async () => {
                const answer = await provideDocumentSymbols(harness, {
                    uri,
                    languageId: "terraform",
                    versionId: documentVersion(harness, uri),
                });
                return answer.length > 0 ? answer : null;
            });
            expect(symbols.map((symbol) => symbol.name)).toEqual([
                'variable "cidr"',
                'resource "aws_vpc" "shared"',
                'module "net"',
            ]);
        }),
    );

    it("`#` finds a resource of a file that is not open, and one of a called module", TIMEOUT, () =>
        withMainTf(async ({ harness }) => {
            const shared = await askWorkspaceSymbols(harness, "shared");
            expect(shared).toEqual([
                expect.objectContaining({
                    name: 'resource "aws_vpc" "shared"',
                    location: expect.objectContaining({
                        uri: Uri.file(path.join(harness.tmpDir, "network.tf")).toString(),
                    }),
                }),
            ]);
            const called = await askWorkspaceSymbols(harness, "module_subnet");
            expect(called.map((symbol) => symbol.name)).toEqual(['resource "aws_subnet" "module_subnet"']);
        }),
    );

    it(
        "`indexing.ignorePaths` reaches the server's walker; a module call indexes the directory all the same",
        TIMEOUT,
        () =>
            withMainTf(
                async ({ harness }) => {
                    const log = path.join(harness.tmpDir, "terraform-ls.log");
                    await until("the walker skipping the directory", () => {
                        const text = fs.existsSync(log) ? fs.readFileSync(log, "utf-8") : "";
                        const excluded = `dir being excluded: ${path.join(harness.tmpDir, "modules")}`;
                        return Promise.resolve(text.includes(excluded) ? true : null);
                    });
                    await askWorkspaceSymbols(harness, "module_subnet");
                },
                async ({ extensionConfiguration, tmpDir }) => {
                    // Absolute paths only.
                    await extensionConfiguration.updateValue("terraform.languageServer.indexing.ignorePaths", [
                        path.join(tmpDir, "modules"),
                    ]);
                    await extensionConfiguration.updateValue("terraform.languageServer.args", [
                        "serve",
                        "-log-file",
                        path.join(tmpDir, "terraform-ls.log"),
                    ]);
                },
            ),
    );

    it("`#` does not reach a directory nothing calls, even without `indexing.ignorePaths`", TIMEOUT, () =>
        withMainTf(
            async ({ harness }) => {
                await askWorkspaceSymbols(harness, "module_subnet");
                const features = harness.languageFeatures.workspaceSymbolProvider;
                const legacy = await getWorkspaceSymbols(features, "legacy_subnet", CancellationTokenNone);
                expect(legacy).toEqual([]);
            },
            (harness) => {
                fs.mkdirSync(path.join(harness.tmpDir, "legacy"));
                harness.writeFile("legacy/main.tf", 'resource "aws_subnet" "legacy_subnet" {}\n');
            },
        ),
    );

    it("the seven features terraform-ls does not offer register nothing", TIMEOUT, () =>
        withMainTf(async ({ harness, editor }) => {
            const features = harness.languageFeatures;
            // Registered dynamically along with the rest, so the ones below had their chance by now.
            expect(features.declarationProvider.has(editor)).toBe(true);
            const absent = {
                implementation: features.implementationProvider,
                typeDefinition: features.typeDefinitionProvider,
                documentHighlight: features.documentHighlightProvider,
                linkedEditing: features.linkedEditingRangeProvider,
                onTypeFormatting: features.onTypeFormattingEditProvider,
                callHierarchy: features.callHierarchyProvider,
                typeHierarchy: features.typeHierarchyProvider,
            };
            const offered = Object.entries(absent).filter(([, registry]) => registry.has(editor));
            expect(offered.map(([name]) => name)).toEqual([]);
        }),
    );
});
