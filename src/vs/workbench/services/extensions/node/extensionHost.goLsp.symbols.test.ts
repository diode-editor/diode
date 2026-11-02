import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { provideDeclarations, provideDocumentSymbols } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { ensureGopls, goToolchainMissing, type IInstalledGo, installGo } from "../../../../../TestUtils/goFixture.ts";
import { openGoFile } from "../../../../../TestUtils/goLspSession.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";

// `@` on the stock extension against the real gopls, and what the server does not offer.

const skipReason = goToolchainMissing();
if (skipReason !== undefined) console.warn(skipReason);

let installed: IInstalledGo;
let gopls: string;

describe.skipIf(MARKETPLACE_OFFLINE || skipReason !== undefined)("ExtensionHost — symbols of stock golang.go", () => {
    beforeAll(async () => {
        gopls = ensureGopls();
        installed = await installGo();
    }, 600_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "`@`: types and functions of the file; the extension's own symbol calls stay out of OUTPUT",
        {
            timeout: 300_000,
        },
        async () => {
            const session = await openGoFile(installed, gopls, "greet/greeter.go");
            try {
                const { harness, at, clientCrashes } = session;
                const request = at("package greet");
                const symbols = await until("the symbols of the file", async () => {
                    const found = await provideDocumentSymbols(harness, request);
                    return found.length > 0 ? found : null;
                });

                const names = symbols.map((symbol) => symbol.name);
                expect(names).toEqual(
                    expect.arrayContaining(["Greeter", "English", "Polite", "Pair", "Speak", "SpeakPair"]),
                );
                expect(clientCrashes()).toEqual([]);
            } finally {
                await session.harness.dispose();
            }
        },
    );

    it(
        "gopls offers no declaration, linked editing or format on type: nothing is registered",
        {
            timeout: 300_000,
        },
        async () => {
            const session = await openGoFile(installed, gopls, "greet/greeter.go");
            try {
                const { harness, editor, at } = session;
                const features = harness.languageFeatures;
                // Registration comes with the server's capabilities, the same moment as definition.
                expect(features.declarationProvider.has(editor)).toBe(false);
                expect(features.linkedEditingRangeProvider.has(editor)).toBe(false);
                expect(features.onTypeFormattingEditProvider.has(editor)).toBe(false);
                await expect(provideDeclarations(harness, at("Speak(g Greeter)"))).resolves.toEqual([]);
            } finally {
                await session.harness.dispose();
            }
        },
    );
});
