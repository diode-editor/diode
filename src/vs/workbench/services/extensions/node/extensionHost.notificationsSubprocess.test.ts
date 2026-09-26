import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { InMemoryClipboard } from "../../../../platform/clipboard/common/inMemoryClipboard.ts";
import type { IExternalOpener } from "../../../../platform/opener/common/iExternalOpener.ts";
import type { IWireShowMessageRequest } from "../../../api/common/wireTypes.ts";

import type { INotificationSink } from "./extensionHost.ts";

// Полный круг сообщений и `env` через НАСТОЯЩИЙ субпроцесс: команда расширения →
// window.showMessage / env.* → RPC → сток хоста → ответ → обратно в расширение.
// Сток здесь — стаб, отвечающий вместо человека: сами тосты закрыты тестами
// NotificationService/NotificationsToastsComponent, а предмет этого теста — провод.

/** Сток-«человек»: отвечает заранее заданным индексом и записывает, о чём спросили. */
function makeSink(answer: (request: IWireShowMessageRequest) => number | undefined) {
    const shown: IWireShowMessageRequest[] = [];
    const sink: INotificationSink = {
        show: (request) => {
            shown.push(request);
            return Promise.resolve(answer(request));
        },
        clear: () => undefined,
    };
    return { sink, shown };
}

const FIXTURE = extensionFixture("test.showsMessages", "showsMessagesAndUsesEnv.cjs");

describe("ExtensionHost — сообщения через настоящий субпроцесс", () => {
    it("строковые пункты уезжают подписями, нажатая приходит обратно строкой", async () => {
        const { sink, shown } = makeSink(() => 1);
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            notificationSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.askWithButtons")).resolves.toBe(
                "picked:Use free version",
            );
            expect(shown[0]).toEqual({
                severity: "info",
                message: "Activate a Pro subscription?",
                items: ["Activate", "Use free version"],
            });
        } finally {
            await harness.dispose();
        }
    });

    it("перегрузка MessageItem возвращает расширению ЕГО ЖЕ объект", async () => {
        const { sink, shown } = makeSink(() => 0);
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            notificationSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.askWithMessageItems")).resolves.toBe(
                "same-object:Retry",
            );
            expect(shown[0]).toMatchObject({ severity: "error", items: ["Retry", "Cancel"] });
        } finally {
            await harness.dispose();
        }
    });

    it("MessageOptions не считается кнопкой", async () => {
        const { sink, shown } = makeSink(() => 0);
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            notificationSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.askModal")).resolves.toBe("picked:Discard");
            expect(shown[0]).toEqual({ severity: "warn", message: "Discard changes?", items: ["Discard"] });
        } finally {
            await harness.dispose();
        }
    });

    it("закрытие без выбора доезжает до расширения как undefined", async () => {
        const { sink } = makeSink(() => undefined);
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            notificationSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.askWithButtons")).resolves.toBe("dismissed");
        } finally {
            await harness.dispose();
        }
    });
});

describe("ExtensionHost — env через настоящий субпроцесс", () => {
    it("буфер обмена: расширение пишет и читает ТОТ ЖЕ карман, что и редактор", async () => {
        const clipboard = new InMemoryClipboard();
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            clipboard,
        });
        try {
            await expect(harness.commandRegistry.execute("test.clipboardRoundTrip")).resolves.toBe(
                "read:from extension",
            );
            await expect(clipboard.readText()).resolves.toBe("from extension");
        } finally {
            await harness.dispose();
        }
    });

    it("openExternal: адрес доезжает БЕЗ percent-кодирования, ответ — обратно", async () => {
        const targets: string[] = [];
        const externalOpener: IExternalOpener = {
            openExternal: (target) => {
                targets.push(target);
                return Promise.resolve(true);
            },
        };
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            externalOpener,
        });
        try {
            await expect(harness.commandRegistry.execute("test.openLink")).resolves.toBe("opened:true");
            expect(targets).toEqual(["https://example.com/activate?token=demo"]);
        } finally {
            await harness.dispose();
        }
    });
});
