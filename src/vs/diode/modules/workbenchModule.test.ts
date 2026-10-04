import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ClipboardDIToken } from "../../platform/clipboard/common/iClipboard.ts";
import { IBulkEditBuffersDIToken } from "../../workbench/contrib/bulkEdit/common/iBulkEditBuffers.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
import { ExternalOpenerDIToken } from "../../workbench/services/externalOpener/common/iExternalOpener.ts";
import { NotificationServiceDIToken } from "../../workbench/services/notification/browser/notificationService.ts";

import { createTestContainer } from "./testProfile.ts";

let tmpDir: string;
let ws: ITempWorkspace;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-wbmodule-" });
    tmpDir = ws.dir;
});

afterEach(() => {
    ws.dispose();
});

/**
 * Проводка открывателя внешних ссылок в DI. Проверяем не «биндинг объявлен», а
 * что через него доезжают НАСТОЯЩИЕ швы: без графического сеанса ссылка обязана
 * оказаться и в буфере обмена приложения, и сообщением на экране. Перепутанный
 * шов даёт рабочий контейнер и молчащий редактор — ровно тот случай, из-за
 * которого расширение «ведёт в никуда».
 */
describe("workbenchModule — env.openExternal", () => {
    it("без графического сеанса кладёт ссылку в буфер приложения и показывает сообщение", async () => {
        const { container } = createTestContainer();
        const noDisplay = { ...process.env };
        delete noDisplay.DISPLAY;
        delete noDisplay.WAYLAND_DISPLAY;
        const restore = process.env;
        try {
            // Окружение читается в момент создания сервиса — правим его вокруг резолва.
            process.env = noDisplay as NodeJS.ProcessEnv;
            const opener = container.get(ExternalOpenerDIToken);
            const notifications = container.get(NotificationServiceDIToken);

            await expect(opener.open("https://example.com/activate?token=42")).resolves.toBe(true);

            expect(await container.get(ClipboardDIToken).readText()).toBe("https://example.com/activate?token=42");
            // Строгость важна: она выбирает заголовок и цвет тоста, а «ссылка в
            // буфере» — сообщение информационное, не ошибка.
            expect(notifications.passive()).toEqual([
                expect.objectContaining({
                    severity: "info",
                    message: "Ссылка скопирована в буфер обмена: https://example.com/activate?token=42",
                }),
            ]);
        } finally {
            process.env = restore;
        }
    });

    it("чужую схему не берётся открывать вовсе", async () => {
        const { container } = createTestContainer();
        const opener = container.get(ExternalOpenerDIToken);

        await expect(opener.open("file:///etc/passwd")).resolves.toBe(false);
        expect(container.get(NotificationServiceDIToken).passive()).toEqual([]);
    });
});

/**
 * Доступ bulk edit'а к открытым буферам: без него `workspace.applyEdit` правил
 * бы открытый файл на диске мимо его буфера — и буфер с файлом разъехались бы.
 * Проверяем не «биндинг объявлен», а что через него видно НАСТОЯЩУЮ вкладку.
 */
describe("workbenchModule — доступ bulk edit'а к буферам", () => {
    it("открытая вкладка видна как буфер, а чужой ресурс — нет", () => {
        const { container } = createTestContainer();
        const editors = container.get(EditorServiceDIToken);
        const buffers = container.get(IBulkEditBuffersDIToken);
        const file = path.join(tmpDir, "open.ts");
        fs.writeFileSync(file, "const a = 1;\n");
        editors.openFile(file);
        const pane = editors.getActiveTabEditor()!;

        const target = buffers.get(pane.uri.toString());
        expect(target).not.toBeNull();
        expect(target).not.toBe("read-only");
        expect(buffers.get("file:///nowhere/closed.ts")).toBeNull();
        // Бакет истории для тронутого буфера — бакет его вкладки.
        expect(buffers.undoContext([pane.uri.toString()])).toBe(pane.undoContext);
    });
});
