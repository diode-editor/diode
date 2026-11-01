import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";

// The whole path of `registerTypeHierarchyProvider`: an extension in the subprocess, the core's registry, sessions
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
        initialFile: { name: "main.ts", content: "root;\nsubA;\nsubB;\nbase;\n" },
        languageService: TS_LANGUAGE_SERVICE,
        extensions: [extensionFixture("test.providesTypeHierarchy", "providesTypeHierarchy.cjs")],
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
    await waitUntil("the provider", () => harness.languageFeatures.typeHierarchyProvider.has(editor));
    const [provider] = harness.languageFeatures.typeHierarchyProvider.ordered(editor);
    const session = await provider.prepareTypeHierarchy(
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

describe("ExtensionHost — type hierarchy providers (subprocess)", () => {
    it("[api:languages.registerTypeHierarchyProvider] [api:TypeHierarchyProvider.prepareTypeHierarchy] [api:TypeHierarchyItem] [api:TypeHierarchyProvider.provideTypeHierarchySubtypes] [api:TypeHierarchyProvider.provideTypeHierarchySupertypes] a root with two subtypes and one supertype, switching direction on the same session", async () => {
        const harness = await open();
        try {
            const { provider, session } = await prepare(harness);
            expect(session.items.map((item) => item.name)).toEqual(["root"]);
            expect(session.items[0].detail).toBe("detail of root");
            expect(session.items[0].kind).toBe(10);
            const rootId = session.items[0].itemId;

            const subtypes = await provider.provideSubtypes(session.sessionId, rootId, CancellationTokenNone);
            expect(subtypes.map((type) => type.name)).toEqual(["subB", "subA"]);

            const supertypes = await provider.provideSupertypes(session.sessionId, rootId, CancellationTokenNone);
            expect(supertypes.map((type) => type.name)).toEqual(["base"]);

            // A language client keeps `data` on the object: it arrives only if the original is what's passed.
            await provider.provideSupertypes(session.sessionId, subtypes[0].itemId, CancellationTokenNone);
            const seen = await harness.commandRegistry.execute("test.typeHierarchy.seen");
            expect(seen).toEqual(["subtypes:root:root-data", "supertypes:root:root-data", "supertypes:subB:b-data"]);
        } finally {
            await harness.dispose();
        }
    });

    it("after release the item is gone: an error in the extension's log and an empty answer, not a crash", async () => {
        const stderr: string[] = [];
        const harness = await open(stderr);
        try {
            const { provider, session } = await prepare(harness);
            provider.releaseTypeHierarchy(session.sessionId);
            // The notification and the request share one ordered channel: the release arrives first.
            const types = await provider.provideSubtypes(
                session.sessionId,
                session.items[0].itemId,
                CancellationTokenNone,
            );
            expect(types).toEqual([]);
            await waitUntil("the failure is reported", () =>
                stderr.some((line) => line.includes("missing type hierarchy item")),
            );
            // The subprocess is alive: a new session works.
            const again = await prepare(harness);
            expect(again.session.sessionId).not.toBe(session.sessionId);
        } finally {
            await harness.dispose();
        }
    });
});
