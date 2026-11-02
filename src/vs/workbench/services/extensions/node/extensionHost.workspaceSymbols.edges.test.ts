import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { CancellationTokenNone, CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { getWorkspaceSymbols } from "../../../contrib/quickaccess/browser/workspaceSymbolsQuickAccessProvider.ts";

function startHarness(): Promise<IExtensionHarness> {
    return createExtensionTestHarness({
        initialFile: { name: "target.ts", content: "line\n".repeat(5) },
        extensions: [extensionFixture("test.providesEdgeWorkspaceSymbols", "providesEdgeWorkspaceSymbols.cjs")],
    });
}

describe("ExtensionHost — workspace symbol provider, odd answers (subprocess)", () => {
    it(
        "answers: nameless dropped, deprecated tag crosses, undefined and throw are empty, cancel reaches the provider, resolve throw rejects without killing the host",
        { timeout: 60_000 },
        async () => {
            const harness = await startHarness();
            try {
                const registry = harness.languageFeatures.workspaceSymbolProvider;

                const items = await getWorkspaceSymbols(registry, "any", CancellationTokenNone);
                expect(items.map((item) => item.symbol.name).sort()).toEqual(["oldOne", "plainObject"]);
                expect(items.find((item) => item.symbol.name === "oldOne")?.symbol.tags).toEqual([1]);
                expect(items.find((item) => item.symbol.name === "plainObject")?.symbol.location.range).toBeDefined();

                expect(await getWorkspaceSymbols(registry, "undefined", CancellationTokenNone)).toEqual([]);
                expect(await getWorkspaceSymbols(registry, "throw", CancellationTokenNone)).toEqual([]);

                const source = new CancellationTokenSource();
                const running = getWorkspaceSymbols(registry, "cancel", source.token);
                await new Promise((resolve) => setTimeout(resolve, 300));
                source.cancel();
                await running;
                await new Promise((resolve) => setTimeout(resolve, 300));
                const [flag] = await getWorkspaceSymbols(registry, "cancelled", CancellationTokenNone);
                expect(flag.symbol.name).toBe("true");

                const [toResolve] = await getWorkspaceSymbols(registry, "resolvethrows", CancellationTokenNone);
                await toResolve.provider.resolveWorkspaceSymbol?.(toResolve.symbol, CancellationTokenNone).then(
                    () => undefined,
                    () => undefined,
                );
                expect(await getWorkspaceSymbols(registry, "any", CancellationTokenNone)).toHaveLength(2);
            } finally {
                await harness.dispose();
            }
        },
    );
});
