import { expect, it } from "vitest";

import { describeStockGo } from "../../../../../TestUtils/goLspSession.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";

// Call and type hierarchy on the stock extension against the real gopls.

const TIMEOUT = { timeout: 300_000 };

describeStockGo("ExtensionHost — hierarchies of stock golang.go", (withGoFile) => {
    it("call hierarchy: Speak is called by SpeakPair and calls Greet", TIMEOUT, () =>
        withGoFile(async ({ harness, editor, at, clientCrashes }) => {
            const [provider] = harness.languageFeatures.callHierarchyProvider.ordered(editor);
            const prepared = await provider.prepareCallHierarchy(at("Speak(g Greeter)"), CancellationTokenNone);
            if (prepared === null) throw new Error("no session");
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
        }),
    );

    it("type hierarchy: the interface has both types as subtypes", TIMEOUT, () =>
        withGoFile(async ({ harness, editor, at, clientCrashes }) => {
            const [provider] = harness.languageFeatures.typeHierarchyProvider.ordered(editor);
            const prepared = await provider.prepareTypeHierarchy(at("Greeter interface"), CancellationTokenNone);
            if (prepared === null) throw new Error("no session");
            expect(prepared.items.map((item) => item.name)).toEqual(["Greeter"]);

            const subtypes = await provider.provideSubtypes(
                prepared.sessionId,
                prepared.items[0].itemId,
                CancellationTokenNone,
            );
            expect(subtypes.map((item) => item.name).sort()).toEqual(["English", "Polite"]);
            expect(clientCrashes()).toEqual([]);
        }),
    );
});
