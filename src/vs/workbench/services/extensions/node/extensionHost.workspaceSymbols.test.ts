import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { SymbolKind } from "../../../../editor/common/languages/symbolKinds.ts";
import { getWorkspaceSymbols } from "../../../contrib/quickaccess/browser/workspaceSymbolsQuickAccessProvider.ts";

function startHarness(): Promise<IExtensionHarness> {
    return createExtensionTestHarness({
        initialFile: { name: "target.ts", content: "line\n".repeat(5) },
        extensions: [extensionFixture("test.providesWorkspaceSymbols", "providesWorkspaceSymbols.cjs")],
    });
}

describe("ExtensionHost — workspace symbol provider (subprocess)", () => {
    it("a partial symbol crosses the wire without a range, resolve brings the location of the original", async () => {
        const harness = await startHarness();
        try {
            const registry = harness.languageFeatures.workspaceSymbolProvider;
            const [item] = await getWorkspaceSymbols(registry, "partial", CancellationTokenNone);

            expect(item.symbol).toMatchObject({
                name: "partialSymbol",
                kind: SymbolKind.Class,
                containerName: "Box",
            });
            expect(item.symbol.location.range).toBeUndefined();
            expect(item.symbol.location.uri.endsWith("/target.ts")).toBe(true);

            const location = await item.provider.resolveWorkspaceSymbol?.(item.symbol, CancellationTokenNone);
            expect(location?.range).toEqual(createRange(2, 4, 2, 10));
        } finally {
            await harness.dispose();
        }
    });

    it("an empty answer is an empty list", async () => {
        const harness = await startHarness();
        try {
            const registry = harness.languageFeatures.workspaceSymbolProvider;
            expect(await getWorkspaceSymbols(registry, "nothing", CancellationTokenNone)).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
