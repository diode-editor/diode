import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { JDK_MISSING, SHAPES_JAVA } from "../../../../../TestUtils/javaFixture.ts";
import { type IJavaSuite, openJavaSuite, waitForStandardServer } from "../../../../../TestUtils/javaHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";

// Java is the only stock server with both hierarchies. Every request is made once, as the panel does: nothing asks
// again after an empty answer. The absence of a deadline itself is tested in languageFeaturesCustomer.test.ts: right
// after the import the first request can take over 5 s, but not reliably.

let suite: IJavaSuite;

async function prepareCalls(name: string, line: number, character: number) {
    const [provider] = suite.harness.languageFeatures.callHierarchyProvider.ordered(suite.editorOf(name));
    const session = await provider.prepareCallHierarchy(suite.at(name, line, character), CancellationTokenNone);
    if (session === null) throw new Error("no call hierarchy session");
    return { provider, sessionId: session.sessionId, itemId: session.items[0].itemId };
}

async function prepareTypes(name: string, line: number, character: number) {
    const [provider] = suite.harness.languageFeatures.typeHierarchyProvider.ordered(suite.editorOf(name));
    const session = await provider.prepareTypeHierarchy(suite.at(name, line, character), CancellationTokenNone);
    if (session === null) throw new Error("no type hierarchy session");
    return { provider, sessionId: session.sessionId, itemId: session.items[0].itemId };
}

describe.skipIf(MARKETPLACE_OFFLINE || JDK_MISSING)("ExtensionHost — stock redhat.java: hierarchies", () => {
    beforeAll(async () => {
        suite = await openJavaSuite({
            sources: SHAPES_JAVA,
            open: ["Circle.java", "Shape.java", "Drawing.java"],
        });
        await waitForStandardServer(suite, "Shape.java", 2, 19);
    }, 400_000);

    afterAll(async () => {
        await suite.dispose();
    });

    it("incoming calls of a method are its caller, with the range of the call", { timeout: 120_000 }, async () => {
        // `measure` in `double measure()`.
        const { provider, sessionId, itemId } = await prepareCalls("Drawing.java", 6, 12);
        const calls = await provider.provideIncomingCalls(sessionId, itemId, CancellationTokenNone);
        expect(calls.map((call) => call.from.name)).toEqual(["render() : double"]);
        expect(calls[0].fromRanges.map((range) => range.start.line)).toEqual([13]);
    });

    it("outgoing calls of a method are the methods it calls", { timeout: 120_000 }, async () => {
        const { provider, sessionId, itemId } = await prepareCalls("Drawing.java", 6, 12);
        const calls = await provider.provideOutgoingCalls(sessionId, itemId, CancellationTokenNone);
        expect(calls.map((call) => call.to.name)).toContain("area() : double");
    });

    it("subtypes of an interface are its two implementations", { timeout: 120_000 }, async () => {
        // `Shape` in `public interface Shape`.
        const { provider, sessionId, itemId } = await prepareTypes("Shape.java", 2, 19);
        const subtypes = await provider.provideSubtypes(sessionId, itemId, CancellationTokenNone);
        expect(subtypes.map((item) => item.name).sort()).toEqual(["Circle", "Square"]);
    });

    it("supertypes of an implementation include the interface", { timeout: 120_000 }, async () => {
        // `Circle` in `public class Circle implements Shape`.
        const { provider, sessionId, itemId } = await prepareTypes("Circle.java", 2, 15);
        const supertypes = await provider.provideSupertypes(sessionId, itemId, CancellationTokenNone);
        expect(supertypes.map((item) => item.name)).toContain("Shape");
    });
});
