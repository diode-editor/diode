import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { provideDocumentSymbols } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { JDK_MISSING, SHAPES_JAVA } from "../../../../../TestUtils/javaFixture.ts";
import { type IJavaSuite, openJavaSuite, waitForStandardServer } from "../../../../../TestUtils/javaHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { SymbolKind } from "../../../../editor/common/languages/symbolKinds.ts";
import { flattenDocumentSymbols } from "../../../contrib/quickaccess/browser/gotoSymbolQuickAccessProvider.ts";
import { getWorkspaceSymbols } from "../../../contrib/quickaccess/browser/workspaceSymbolsQuickAccessProvider.ts";

// redhat.java registers its own document symbol provider over the client's: the first non-empty answer must not
// bring the same symbols twice. Workspace symbols come only from the standard server.

/** Name and file of what `#` finds for the query, resolved as the picker resolves a partial symbol. */
async function workspaceSymbols(suite: IJavaSuite, query: string): Promise<string[]> {
    const items = await getWorkspaceSymbols(
        suite.harness.languageFeatures.workspaceSymbolProvider,
        query,
        CancellationTokenNone,
    );
    return items.map(({ symbol }) => `${symbol.name} ${path.basename(Uri.parse(symbol.location.uri).fsPath)}`);
}

describe.skipIf(MARKETPLACE_OFFLINE || JDK_MISSING)("ExtensionHost — stock redhat.java: symbols", () => {
    let suite: IJavaSuite;

    beforeAll(async () => {
        suite = await openJavaSuite({ sources: SHAPES_JAVA, open: ["Drawing.java"] });
    }, 400_000);

    afterAll(async () => {
        await suite.dispose();
    });

    it("@ lists the class, its fields and methods, each once, with the container", { timeout: 300_000 }, async () => {
        const symbols = await until(
            "document symbols",
            async () => {
                const found = await provideDocumentSymbols(suite.harness, suite.at("Drawing.java", 0, 0));
                return found.length > 0 ? found : null;
            },
            280_000,
        );
        const flat = flattenDocumentSymbols(symbols).map((symbol) => [symbol.name, symbol.kind, symbol.containerName]);
        expect(flat).toEqual([
            ["demo", SymbolKind.Package, ""],
            ["Drawing", SymbolKind.Class, ""],
            ["shape", SymbolKind.Field, "Drawing"],
            ["count", SymbolKind.Field, "Drawing"],
            ["measure()", SymbolKind.Method, "Drawing"],
            ["render()", SymbolKind.Method, "Drawing"],
        ]);
    });

    it(
        "# finds a class from a file that is not open; source methods are off by default",
        { timeout: 400_000 },
        async () => {
            await waitForStandardServer(suite, "Drawing.java", 2, 13);
            const found = await until(
                "the class from another file",
                async () => {
                    const names = await workspaceSymbols(suite, "Circle");
                    return names.includes("Circle Circle.java") ? names : null;
                },
                120_000,
            );
            expect(found).toContain("Circle Circle.java");
            expect(await workspaceSymbols(suite, "measure")).toEqual([]);
        },
    );
});

describe.skipIf(MARKETPLACE_OFFLINE || JDK_MISSING)(
    "ExtensionHost — stock redhat.java: symbols with java.symbols.includeSourceMethodDeclarations",
    () => {
        let suite: IJavaSuite;

        beforeAll(async () => {
            suite = await openJavaSuite({
                sources: SHAPES_JAVA,
                open: ["Drawing.java"],
                configuration: { "java.symbols.includeSourceMethodDeclarations": true },
            });
            await waitForStandardServer(suite, "Drawing.java", 2, 13);
        }, 400_000);

        afterAll(async () => {
            await suite.dispose();
        });

        it("# finds a method declared in a source file", { timeout: 200_000 }, async () => {
            const found = await until(
                "the source method",
                async () => {
                    const names = await workspaceSymbols(suite, "measure");
                    return names.length > 0 ? names : null;
                },
                120_000,
            );
            expect(found).toEqual(["measure Drawing.java"]);
        });
    },
);
