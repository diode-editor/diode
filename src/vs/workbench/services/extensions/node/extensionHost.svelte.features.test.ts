import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { documentVersion, provideDocumentSymbols } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledSvelte, installSvelte, withSvelteFiles } from "../../../../../TestUtils/svelteFixture.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { FeatureDebounce } from "../../../../editor/common/services/languageFeatureDebounce.ts";
import { DEFAULT_CODE_LENS_OPTIONS } from "../../../../editor/contrib/codelens/browser/codeLensController.ts";
import { DEFAULT_INLAY_HINTS_OPTIONS } from "../../../../editor/contrib/inlayHints/browser/inlayHintsController.ts";
import { LinkedEditingController } from "../../../../editor/contrib/linkedEditing/browser/linkedEditingController.ts";
import { getWorkspaceSymbols } from "../../../contrib/quickaccess/browser/workspaceSymbolsQuickAccessProvider.ts";

// What stock svelte.svelte-vscode shows besides navigation. The manifest declares no `svelte.*` keys for inlay hints
// and the references lens: the server reads TypeScript's (`typescript.inlayHints.*`,
// `typescript.referencesCodeLens.enabled`), as its README says.

const TIMEOUT = { timeout: 240_000 };

const INLAY_SETTINGS = {
    "typescript.inlayHints.variableTypes.enabled": true,
    "typescript.inlayHints.functionLikeReturnTypes.enabled": true,
    "typescript.inlayHints.parameterNames.enabled": "all",
};

let installed: IInstalledSvelte;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — features of stock svelte.svelte-vscode", () => {
    beforeAll(async () => {
        installed = await installSvelte();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("inlay hints by the typescript.inlayHints settings reach the frame", TIMEOUT, () =>
        withSvelteFiles(
            installed,
            async (session) => {
                session.activeEditor().setInlayHints(DEFAULT_INLAY_HINTS_OPTIONS);
                await session.frameHas("let count : number = 0;", "function increment() : void {");
            },
            INLAY_SETTINGS,
        ),
    );

    it("the references code lens by typescript.referencesCodeLens.enabled", TIMEOUT, () =>
        withSvelteFiles(
            installed,
            async (session) => {
                session.activeEditor().setCodeLens(DEFAULT_CODE_LENS_OPTIONS);
                await session.frameHas("references");
            },
            { "typescript.referencesCodeLens.enabled": true },
        ),
    );

    it("document symbols of the script and the markup", TIMEOUT, () =>
        withSvelteFiles(installed, async (session) => {
            const uri = session.uriOf("App.svelte");
            const symbols = await until("the document symbols", async () => {
                const found = await provideDocumentSymbols(session.harness, {
                    uri,
                    languageId: "svelte",
                    versionId: documentVersion(session.harness, uri),
                });
                return found.length > 0 ? found : null;
            });
            const names = (list: typeof symbols): string[] =>
                list.flatMap((symbol) => [symbol.name, ...names(symbol.children)]);
            expect(names(symbols)).toEqual(expect.arrayContaining(["count", "user", "increment", "main"]));
        }),
    );

    it("workspace symbols find an interface in a .ts file", TIMEOUT, () =>
        withSvelteFiles(installed, async ({ harness }) => {
            const symbol = await until("the workspace symbol", async () => {
                const found = await getWorkspaceSymbols(
                    harness.languageFeatures.workspaceSymbolProvider,
                    "User",
                    CancellationTokenNone,
                );
                return found.map((item) => item.symbol).find(({ name }) => name === "User") ?? null;
            });
            expect(symbol.location.uri).toBe(Uri.file(`${harness.tmpDir}/util.ts`).toString());
        }),
    );

    it("occurrences of count: the declaration, the write in the script and the read in the markup", TIMEOUT, () =>
        withSvelteFiles(installed, async (session) => {
            const editor = session.activeEditor();
            const count = session.at("App.svelte", "let count", 4);
            await waitUntil("the provider", () => session.harness.languageFeatures.documentHighlightProvider.has(editor));
            editor.viewState.selections = [createCursorSelection(count.line, count.character + 1)];
            await waitUntil("the highlights", () => editor.viewState.wordHighlights.write.length > 0, 60_000);
            const { read, write } = editor.viewState.wordHighlights;
            expect(write.map(({ start }) => start.line).sort((a, b) => a - b)).toEqual([4, 7]);
            expect(read.map(({ start }) => start.line)).toEqual([14]);
        }),
    );

    it("call hierarchy: greet from util.ts, called in the markup of App.svelte", TIMEOUT, () =>
        withSvelteFiles(installed, async (session) => {
            const editor = session.activeEditor();
            const [provider] = session.harness.languageFeatures.callHierarchyProvider.ordered(editor);
            const prepared = await provider.prepareCallHierarchy(
                session.at("App.svelte", "greet(user)"),
                CancellationTokenNone,
            );
            if (prepared === null) throw new Error("no call hierarchy session");
            expect(prepared.items.map(({ name, uri }) => [name, uri])).toEqual([["greet", session.uriOf("util.ts")]]);
            const callers = await provider.provideIncomingCalls(
                prepared.sessionId,
                prepared.items[0].itemId,
                CancellationTokenNone,
            );
            expect(callers.map(({ from, fromRanges }) => [from.name, fromRanges[0].start])).toEqual([
                ["App.svelte", { line: 12, character: 9 }],
            ]);
        }),
    );

    it("linked editing: typing in the opening tag rewrites the closing one", TIMEOUT, () =>
        withSvelteFiles(installed, async (session) => {
            const editor = session.activeEditor();
            const controller = new LinkedEditingController(editor, {
                providers: session.harness.languageFeatures.linkedEditingRangeProvider,
                isSettingEnabled: () => true,
                languageWordPattern: () => undefined,
                debounce: new FeatureDebounce(50, 200),
            });
            try {
                const main = session.at("App.svelte", "<main>", 1);
                controller.reinitialize(false);
                editor.viewState.selections = [createCursorSelection(main.line, main.character + 4)];
                await waitUntil("the linked ranges", () => editor.viewState.linkedEditingRanges.length === 2, 60_000);
                editor.pushUndo(editor.viewState.type("x"));
                await waitUntil("the mirror", () => editor.getText().includes("<mainx>") && editor.getText().includes("</mainx>"));
            } finally {
                controller.dispose();
            }
        }),
    );

    it("providers the server does not have: type hierarchy, on-type formatting, document links", TIMEOUT, () =>
        withSvelteFiles(installed, async (session) => {
            const editor = session.activeEditor();
            const features = session.harness.languageFeatures;
            expect({
                typeHierarchy: features.typeHierarchyProvider.has(editor),
                onTypeFormatting: features.onTypeFormattingEditProvider.has(editor),
                links: features.documentLinkProvider.has(editor),
            }).toEqual({ typeHierarchy: false, onTypeFormatting: false, links: false });
        }),
    );
});
