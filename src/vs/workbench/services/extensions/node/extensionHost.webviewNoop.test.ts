import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";

/**
 * Расширение с чат-панелью обязано активироваться ЦЕЛИКОМ. Webview в TUI не
 * будет by design, но его отсутствие не должно убивать всё остальное: пока
 * `window.createWebviewPanel` / `registerWebviewViewProvider` /
 * `registerWebviewPanelSerializer` отсутствуют в шиме, `activate()` падает на
 * первом же обращении, и вместе с панелью пропадают команды и провайдеры
 * расширения — пользователь получает мёртвое расширение, а не просто
 * отсутствующую панель.
 */
const WEBVIEW_ENTRY_POINTS = [
    "createWebviewPanel",
    "registerWebviewViewProvider",
    "registerWebviewPanelSerializer",
] as const;

const REQ = {
    uri: Uri.file("/proj/main.ts").toString(),
    languageId: "typescript",
    text: "const x = ",
    line: 0,
    character: 10,
    triggerKind: InlineCompletionTriggerKind.Automatic,
};

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
                expect(await harness.host.provideInlineCompletions(REQ)).toEqual([{ insertText: "GHOST" }]);
            } finally {
                await harness.dispose();
            }
        });
    });
});
