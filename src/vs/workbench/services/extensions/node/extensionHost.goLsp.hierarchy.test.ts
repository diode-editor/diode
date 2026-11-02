import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { ensureGopls, goToolchainMissing, type IInstalledGo, installGo } from "../../../../../TestUtils/goFixture.ts";
import { openGoFile } from "../../../../../TestUtils/goLspSession.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";

// Call and type hierarchy on the stock extension against the real gopls.

const skipReason = goToolchainMissing();
if (skipReason !== undefined) console.warn(skipReason);

let installed: IInstalledGo;
let gopls: string;

describe.skipIf(MARKETPLACE_OFFLINE || skipReason !== undefined)(
    "ExtensionHost — hierarchies of stock golang.go",
    () => {
        beforeAll(async () => {
            gopls = ensureGopls();
            installed = await installGo();
        }, 600_000);

        afterAll(() => {
            installed.dispose();
        });

        it("call hierarchy: Speak is called by SpeakPair and calls Greet", { timeout: 300_000 }, async () => {
            const session = await openGoFile(installed, gopls, "greet/greeter.go");
            try {
                const { harness, editor, at, clientCrashes } = session;
                const features = harness.languageFeatures.callHierarchyProvider;
                await waitUntil("the provider", () => features.has(editor));
                const [provider] = features.ordered(editor);
                const prepared = await until("the session of Speak", async () => {
                    const { uri, languageId, versionId, line, character } = at("Speak(g Greeter)");
                    const found = await provider.prepareCallHierarchy(
                        { uri, languageId, versionId, line, character },
                        CancellationTokenNone,
                    );
                    return found !== null && found.items.length > 0 ? found : null;
                });
                expect(prepared.items.map((item) => item.name)).toEqual(["Speak"]);
                const [speak] = prepared.items;

                const callers = await provider.provideIncomingCalls(
                    prepared.sessionId,
                    speak.itemId,
                    CancellationTokenNone,
                );
                expect(callers.map((call) => call.from.name)).toEqual(["SpeakPair"]);
                // `Speak(pair.First) + Speak(pair.Second)`: two calls from one caller.
                expect(callers[0].fromRanges).toHaveLength(2);

                const callees = await provider.provideOutgoingCalls(
                    prepared.sessionId,
                    speak.itemId,
                    CancellationTokenNone,
                );
                expect(callees.map((call) => call.to.name)).toEqual(expect.arrayContaining(["Greet", "Println"]));
                expect(clientCrashes()).toEqual([]);
            } finally {
                await session.harness.dispose();
            }
        });

        it("type hierarchy: the interface has both types as subtypes", { timeout: 300_000 }, async () => {
            const session = await openGoFile(installed, gopls, "greet/greeter.go");
            try {
                const { harness, editor, at, clientCrashes } = session;
                const features = harness.languageFeatures.typeHierarchyProvider;
                await waitUntil("the provider", () => features.has(editor));
                const [provider] = features.ordered(editor);
                const prepared = await until("the session of Greeter", async () => {
                    const { uri, languageId, versionId, line, character } = at("Greeter interface");
                    const found = await provider.prepareTypeHierarchy(
                        { uri, languageId, versionId, line, character },
                        CancellationTokenNone,
                    );
                    return found !== null && found.items.length > 0 ? found : null;
                });
                expect(prepared.items.map((item) => item.name)).toEqual(["Greeter"]);

                const subtypes = await provider.provideSubtypes(
                    prepared.sessionId,
                    prepared.items[0].itemId,
                    CancellationTokenNone,
                );
                expect(subtypes.map((item) => item.name).sort()).toEqual(["English", "Polite"]);
                expect(clientCrashes()).toEqual([]);
            } finally {
                await session.harness.dispose();
            }
        });
    },
);
