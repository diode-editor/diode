import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Комбинации, которые обычный терминал передать не может.
//
// Ctrl+Shift+F/G и Ctrl+Tab на legacy-терминале физически неотличимы от Ctrl+F,
// Ctrl+G и Tab, поэтому у команд есть запасной путь: leader-аккорды Ctrl+K F /
// Ctrl+K G и Ctrl+6 (control-код 0x1e доходит везде). E2E-спаун герметичен —
// маркеры терминала вычищены, tier там ровно `legacy`, то есть тот же режим,
// в котором сидит пользователь под tmux.

const files = {
    "alpha.ts": "const alpha = 1;\n",
    "bravo.ts": "const bravo = 2;\n",
};

async function frameText(session: HeadlessSession): Promise<string> {
    return frameToText(await session.captureFrame());
}

describe("Фоллбэки клавиш для legacy-терминала", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("Ctrl+6 тумблерит два последних редактора", async () => {
        const { session } = await useHeadlessApp({ files, open: ["alpha.ts", "bravo.ts"] });
        await session.waitForText((t) => t.includes("const bravo"));

        await session.key("Ctrl+6");
        await session.waitForText((t) => t.includes("const alpha"));
        expect(await frameText(session)).toContain("const alpha");

        // Второй раз возвращает обратно — это тумблер, а не проход вглубь стека.
        await session.key("Ctrl+6");
        await session.waitForText((t) => t.includes("const bravo"));
    }, 120_000);

    // Сайдбар показывает вьюлеты только при открытой папке — открываем воркспейс
    // вместе с файлом, иначе команда отработает «в никуда».
    it("Ctrl+K F открывает Search, Ctrl+K G — Source Control", async () => {
        const { session } = await useHeadlessApp({ files, open: [".", "alpha.ts"] });
        await session.waitForText((t) => t.includes("const alpha"));

        await session.key("Ctrl+K");
        await session.key("f");
        await session.waitForText((t) => t.includes("SEARCH"));

        await session.key("Ctrl+K");
        await session.key("g");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
    }, 120_000);
});
