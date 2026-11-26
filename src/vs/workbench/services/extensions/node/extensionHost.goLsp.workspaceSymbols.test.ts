import { expect, it } from "vitest";

import { describeStockGo } from "../../../../../TestUtils/goLspSession.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { getWorkspaceSymbols } from "../../../contrib/quickaccess/browser/workspaceSymbolsQuickAccessProvider.ts";

// `#` on the stock extension against the real gopls: the open file is greet/greeter.go, the symbol lives elsewhere.
// The row order on the real picker, with runtime symbols around it, is in the `go-navigation` scenario.

describeStockGo("ExtensionHost — workspace symbols of stock golang.go", (withGoFile) => {
    it("`#` finds a symbol of another file", { timeout: 300_000 }, () =>
        withGoFile(async ({ harness, clientCrashes }) => {
            const items = await getWorkspaceSymbols(
                harness.languageFeatures.workspaceSymbolProvider,
                "Hello",
                CancellationTokenNone,
            );

            const hello = items.find((item) => item.symbol.name.endsWith("Hello"));
            expect(hello?.symbol.location.uri.endsWith("/greet/greet.go")).toBe(true);
            expect(clientCrashes()).toEqual([]);
        }),
    );
});
