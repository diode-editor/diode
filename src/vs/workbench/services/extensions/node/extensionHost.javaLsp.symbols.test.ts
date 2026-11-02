import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { provideDocumentSymbols } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { JDK_MISSING, SHAPES_JAVA } from "../../../../../TestUtils/javaFixture.ts";
import { type IJavaSuite, openJavaSuite } from "../../../../../TestUtils/javaHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { SymbolKind } from "../../../../editor/common/languages/symbolKinds.ts";
import { flattenDocumentSymbols } from "../../../contrib/quickaccess/browser/gotoSymbolQuickAccessProvider.ts";

// redhat.java registers its own document symbol provider over the client's: the first non-empty answer must not
// bring the same symbols twice.

let suite: IJavaSuite;

describe.skipIf(MARKETPLACE_OFFLINE || JDK_MISSING)("ExtensionHost — stock redhat.java: symbols", () => {
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
});
