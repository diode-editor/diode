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

/** Webview в TUI не будет, но без этих точек входа `activate()` расширения с чат-панелью падает целиком. */
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

describe("ExtensionHost — расширение с чат-панелью (webview) активируется целиком", () => {
    describe.each(WEBVIEW_ENTRY_POINTS)("window.%s", (api) => {
        it("команда расширения, зарегистрированная после webview-вызова, исполняется", async () => {
            const harness = await chatExtensionHarness(api);
            try {
                await settle();
                expect(harness.commandRegistry.has("test.chatPing")).toBe(true);
                expect(await harness.commandRegistry.execute("test.chatPing")).toBe("pong");
            } finally {
                await harness.dispose();
            }
        });

        it("призрачные подсказки расширения доезжают до ядра", async () => {
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
