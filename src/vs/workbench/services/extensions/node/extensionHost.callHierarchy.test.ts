import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";

// The whole path of `registerCallHierarchyProvider`: an extension in the subprocess, the core's registry, sessions
// that keep the extension's own objects.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

async function open(stderr: string[] = []): Promise<IExtensionHarness> {
    const record = (message: string): void => {
        stderr.push(message);
    };
    return createExtensionTestHarness({
        initialFile: { name: "main.ts", content: "root();\ncallerA();\ncallerB();\ncallee();\n" },
        languageService: TS_LANGUAGE_SERVICE,
        extensions: [extensionFixture("test.providesCallHierarchy", "providesCallHierarchy.cjs")],
        stderrLogger: {
            error: record,
            warn: record,
            info: record,
            debug: record,
            trace: record,
            isEnabled: () => true,
        },
    });
}

async function prepare(harness: IExtensionHarness) {
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    await waitUntil("the provider", () => harness.languageFeatures.callHierarchyProvider.has(editor));
    const [provider] = harness.languageFeatures.callHierarchyProvider.ordered(editor);
    const session = await provider.prepareCallHierarchy(
        {
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            versionId: editor.model.document.versionId,
            line: 0,
            character: 0,
        },
        CancellationTokenNone,
    );
    if (session === null) throw new Error("no session");
    return { provider, session };
}

describe("ExtensionHost — call hierarchy providers (subprocess)", () => {
    it("[api:languages.registerCallHierarchyProvider] [api:CallHierarchyProvider.prepareCallHierarchy] [api:CallHierarchyItem] [api:CallHierarchyIncomingCall] [api:CallHierarchyProvider.provideCallHierarchyIncomingCalls] callers come with the provider seeing its own objects", async () => {
        const harness = await open();
        try {
            const { provider, session } = await prepare(harness);
            expect(session.items.map((item) => item.name)).toEqual(["root"]);
            expect(session.items[0].detail).toBe("detail of root");
            expect(session.items[0].kind).toBe(11);

            const callers = await provider.provideIncomingCalls(
                session.sessionId,
                session.items[0].itemId,
                CancellationTokenNone,
            );
            expect(callers.map((call) => call.from.name)).toEqual(["callerB", "callerA"]);
            expect(callers[1].fromRanges.map((range) => range.start.character)).toEqual([6, 2]);

            // A language client keeps `data` on the object: it arrives only if the original is what's passed.
            await provider.provideIncomingCalls(session.sessionId, callers[0].from.itemId, CancellationTokenNone);
            const seen = await harness.commandRegistry.execute("test.callHierarchy.seen");
            expect(seen).toEqual(["incoming:root:root-data", "incoming:callerB:b-data"]);
        } finally {
            await harness.dispose();
        }
    });

    it("[api:CallHierarchyOutgoingCall] [api:CallHierarchyProvider.provideCallHierarchyOutgoingCalls] callees of the same item", async () => {
        const harness = await open();
        try {
            const { provider, session } = await prepare(harness);
            const callees = await provider.provideOutgoingCalls(
                session.sessionId,
                session.items[0].itemId,
                CancellationTokenNone,
            );
            expect(callees.map((call) => call.to.name)).toEqual(["callee"]);
        } finally {
            await harness.dispose();
        }
    });

    it("after release the item is gone: an error in the extension's log and an empty answer, not a crash", async () => {
        const stderr: string[] = [];
        const harness = await open(stderr);
        try {
            const { provider, session } = await prepare(harness);
            provider.releaseCallHierarchy(session.sessionId);
            // The notification and the request share one ordered channel: the release arrives first.
            const calls = await provider.provideIncomingCalls(
                session.sessionId,
                session.items[0].itemId,
                CancellationTokenNone,
            );
            expect(calls).toEqual([]);
            await waitUntil("the failure is reported", () =>
                stderr.some((line) => line.includes("missing call hierarchy item")),
            );
            // The subprocess is alive: a new session works.
            const again = await prepare(harness);
            expect(again.session.sessionId).not.toBe(session.sessionId);
        } finally {
            await harness.dispose();
        }
    });
});
