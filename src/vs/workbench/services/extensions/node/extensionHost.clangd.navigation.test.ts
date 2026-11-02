import { expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { writeCompileCommands } from "../../../../../TestUtils/clangdFixture.ts";
import { describeStockClangd, type IClangdSession } from "../../../../../TestUtils/clangdSession.ts";
import {
    provideDeclarations,
    provideDocumentSymbols,
    provideImplementations,
    provideTypeDefinitions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";
import { DEFAULT_INLAY_HINTS_OPTIONS } from "../../../../editor/contrib/inlayHints/browser/inlayHintsController.ts";
import { getLinks } from "../../../../editor/contrib/links/browser/getLinks.ts";
import { getWorkspaceSymbols } from "../../../contrib/quickaccess/browser/workspaceSymbolsQuickAccessProvider.ts";

// The navigation features clangd registers, on the stock extension against the machine's clangd. What needs the
// project index (implementations, callers, subtypes, `#`) runs with a compilation database: without one clangd
// indexes only the open files, and the index lands after the first answers.

const TIMEOUT = { timeout: 240_000 };

const WITH_INDEX = {
    beforeServer: (dir: string) => {
        writeCompileCommands(dir, dir);
    },
};

function targets(found: readonly ICoreDefinitionLocation[]): [string, number][] {
    return found.map((target) => [target.uri, target.range.start.line]);
}

function askLinks({ harness, editor }: IClangdSession) {
    const document = editor.viewState.document;
    return getLinks(
        harness.languageFeatures.documentLinkProvider,
        editor,
        { uri: editor.uri.toString(), languageId: editor.languageId, versionId: document.versionId, document },
        CancellationTokenNone,
    );
}

describeStockClangd("ExtensionHost — navigation of stock vscode-clangd", (withCppFile) => {
    it("inlay hints show the parameter names on the frame", TIMEOUT, () =>
        withCppFile(async ({ editor, frame }) => {
            editor.setInlayHints(DEFAULT_INLAY_HINTS_OPTIONS);
            await until("the hints on the frame", () =>
                frame().includes("Square square(side: 2.0);") && frame().includes("total(a: square, b: square)")
                    ? true
                    : null,
            );
        }),
    );

    it("occurrences of a local are highlighted at the caret", TIMEOUT, () =>
        withCppFile(async ({ editor, at, frame }) => {
            const declaration = at("square(2.0)");
            editor.viewState.selections = [createCursorSelection(declaration.line, declaration.character)];
            await until("the occurrences", () => {
                frame();
                return editor.viewState.wordHighlights.ranges.length === 4 ? true : null;
            });
        }),
    );

    it("Declaration, Type Definition and the #include link", TIMEOUT, () =>
        withCppFile(async (session) => {
            const { harness, at, uriOf, clientCrashes } = session;
            expect(targets(await provideDeclarations(harness, at("total(square", 1)))).toEqual([
                [uriOf("shape.h"), 13],
            ]);
            expect(targets(await provideTypeDefinitions(harness, at("square.area", 1)))).toEqual([
                [uriOf("shape.h"), 7],
            ]);

            const links = await askLinks(session);
            const include = at('"shape.h"', 1);
            expect(links.map((link) => [link.range.start, link.url])).toEqual([
                [{ line: include.line, character: include.character - 1 }, uriOf("shape.h")],
            ]);
            expect(clientCrashes()).toEqual([]);
        }),
    );

    it("`@` lists the types and functions of the header", TIMEOUT, () =>
        withCppFile(
            async ({ harness, at }) => {
                const symbols = await provideDocumentSymbols(harness, at("struct Shape"));
                expect(symbols.map((symbol) => symbol.name)).toEqual(["Shape", "Square", "total"]);
            },
            { file: "shape.h" },
        ),
    );

    it("with the index: Implementations of the pure virtual, `#`, callers and subtypes", TIMEOUT, () =>
        withCppFile(
            async ({ harness, editor, at, uriOf, clientCrashes }) => {
                const implementations = await until("Square::area", async () => {
                    const found = await provideImplementations(harness, at("area() const = 0", 1));
                    return found.length > 0 ? found : null;
                });
                expect(targets(implementations)).toEqual([[uriOf("shape.h"), 9]]);

                const workspace = await until("`#` for total", async () => {
                    const items = await getWorkspaceSymbols(
                        harness.languageFeatures.workspaceSymbolProvider,
                        "total",
                        CancellationTokenNone,
                    );
                    return items.length > 0 ? items : null;
                });
                // clangd answers with the definition, a file that is not open.
                expect(workspace.map((item) => [item.symbol.name, item.symbol.location.uri])).toEqual([
                    ["total", uriOf("shape.cpp")],
                ]);

                const [calls] = harness.languageFeatures.callHierarchyProvider.ordered(editor);
                const preparedCall = await calls.prepareCallHierarchy(at("double total", 7), CancellationTokenNone);
                if (preparedCall === null) throw new Error("no call hierarchy session");
                expect(preparedCall.items.map((item) => item.name)).toEqual(["total"]);
                const callers = await until("the caller of total", async () => {
                    const found = await calls.provideIncomingCalls(
                        preparedCall.sessionId,
                        preparedCall.items[0].itemId,
                        CancellationTokenNone,
                    );
                    return found.length > 0 ? found : null;
                });
                expect(callers.map((call) => call.from.name)).toEqual(["main"]);

                const [types] = harness.languageFeatures.typeHierarchyProvider.ordered(editor);
                const preparedType = await types.prepareTypeHierarchy(at("struct Shape", 7), CancellationTokenNone);
                if (preparedType === null) throw new Error("no type hierarchy session");
                const subtypes = await types.provideSubtypes(
                    preparedType.sessionId,
                    preparedType.items[0].itemId,
                    CancellationTokenNone,
                );
                expect(subtypes.map((item) => item.name)).toEqual(["Square"]);
                expect(clientCrashes()).toEqual([]);
            },
            { ...WITH_INDEX, file: "shape.h" },
        ),
    );
});
