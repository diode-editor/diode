import { expect, it } from "vitest";

import { provideDeclarations, provideDocumentSymbols } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { describeStockGo } from "../../../../../TestUtils/goLspSession.ts";

// `@` on the stock extension against the real gopls, and what the server does not offer.

const TIMEOUT = { timeout: 300_000 };

describeStockGo("ExtensionHost — symbols of stock golang.go", (withGoFile) => {
    it("`@`: types and functions of the file; the extension's own symbol calls stay out of OUTPUT", TIMEOUT, () =>
        withGoFile(async ({ harness, at, clientCrashes }) => {
            const symbols = await provideDocumentSymbols(harness, at("package greet"));

            expect(symbols.map((symbol) => symbol.name)).toEqual(
                expect.arrayContaining(["Greeter", "English", "Polite", "Pair", "Speak", "SpeakPair"]),
            );
            expect(clientCrashes()).toEqual([]);
        }),
    );

    it("gopls offers no declaration, linked editing or format on type: nothing is registered", TIMEOUT, () =>
        withGoFile(async ({ harness, editor, at }) => {
            const features = harness.languageFeatures;
            expect(features.declarationProvider.has(editor)).toBe(false);
            expect(features.linkedEditingRangeProvider.has(editor)).toBe(false);
            expect(features.onTypeFormattingEditProvider.has(editor)).toBe(false);
            await expect(provideDeclarations(harness, at("Speak(g Greeter)"))).resolves.toEqual([]);
        }),
    );
});
