import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Отмена мультикурсорной вставки в собранном бинаре. Батч правок применяется
// снизу вверх, а события изменения документа летят в документном порядке: без
// сдвига границ на уже отправленные события вью получала номера строк мимо
// документа — и необработанное исключение в главном цикле убивало ПРОЦЕСС
// редактора (у пользователя это выглядело как `TypeError` / `Line index out of
// bounds` и выпадение в шелл). Юнит-тесты видят только исключение, а гибель
// процесса — только отсюда, поэтому проверка живёт в e2e.

describe("Мультикурсор: undo вставки многострочного текста", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("редактор остаётся жив, текст и каретки возвращаются", async () => {
        const { session } = await useHeadlessApp({
            files: { "empty.txt": "\n\n\n\n" },
            open: ["empty.txt"],
            cols: 80,
            rows: 16,
        });
        await session.waitForText((t) => t.includes("empty.txt"));

        // Две каретки на пустых строках в КОНЦЕ документа: вставка сдвинет строки
        // под нижней кареткой, и откат адресует уже несуществующие номера.
        for (let i = 0; i < 4; i++) await session.key("ArrowDown");
        await session.key("Shift+Alt+ArrowUp");
        await session.waitForText((t) => t.includes("(2 selections)"));

        // Вставка (не набор) — один батч правок на обе каретки.
        await session.text("ins\ntext");
        await session.waitForText((t) => /Ln 5, Col 5/u.test(t));
        expect(frameToText(await session.captureFrame())).toContain("ins");

        await session.key("Ctrl+z");

        // Кадр снялся — процесс жив; текст пуст, каретки снова две.
        const frame = frameToText(await session.waitForText((t) => !t.includes("ins")));
        expect(frame).toContain("(2 selections)");
        expect(frame).toMatch(/Ln 4, Col 1/u);
    });
});
