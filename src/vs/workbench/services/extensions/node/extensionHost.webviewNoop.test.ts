import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
    provideInlineCompletions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import {
    type IInlineCompletionRequest,
    InlineCompletionTriggerKind,
} from "../../../../editor/common/languages/iInlineCompletionSource.ts";

/**
 * There will be no webview in a TUI, but without these entry points `activate()` of an extension
 * with a chat panel fails entirely.
 */
const WEBVIEW_ENTRY_POINTS = [
    "createWebviewPanel",
    "registerWebviewViewProvider",
    "registerWebviewPanelSerializer",
] as const;

function requestIn(harness: IExtensionHarness): IInlineCompletionRequest {
    const uri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
    return {
        uri,
        languageId: "typescript",
        versionId: documentVersion(harness, uri),
        line: 0,
        character: 10,
        triggerKind: InlineCompletionTriggerKind.Automatic,
    };
}

function chatExtensionHarness(api: string): Promise<Awaited<ReturnType<typeof createExtensionTestHarness>>> {
    return createExtensionTestHarness({
        initialFile: { name: "main.ts", content: "const x = " },
        configuration: { testChat: { webviewApi: api } },
        extensions: [extensionFixture("test.chatPanel", "chatPanelExtension.cjs")],
    });
}

describe("ExtensionHost — an extension with a chat panel (webview) activates fully", () => {
    describe.each(WEBVIEW_ENTRY_POINTS)("window.%s", (api) => {
        it("an extension command registered after a webview call runs", async () => {
            const harness = await chatExtensionHarness(api);
            try {
                await settle();
                expect(harness.commandRegistry.has("test.chatPing")).toBe(true);
                expect(await harness.commandRegistry.execute("test.chatPing")).toBe("pong");
            } finally {
                await harness.dispose();
            }
        });

        it("the extension's ghost text suggestions reach the core", async () => {
            const harness = await chatExtensionHarness(api);
            try {
                await settle();
                expect(await provideInlineCompletions(harness, requestIn(harness))).toEqual([{ insertText: "GHOST" }]);
            } finally {
                await harness.dispose();
            }
        });
    });
});
