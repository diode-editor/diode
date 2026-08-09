import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// F3 продолжает поиск с закрытым виджетом — как в VS Code, где «Find Next» висит
// на фокусе редактора (`EditorContextKeys.focus`), а не на видимости виджета.
// Наблюдаемый признак — позиция курсора в статус-баре: поиск тянет её за собой.

const files = { "notes.txt": "alpha\nbeta\nalpha\ngamma\nalpha\n" };

/** «Ln N, Col M» из статус-бара. */
async function cursor(session: HeadlessSession): Promise<string> {
    const text = frameToText(await session.captureFrame());
    const m = /Ln (\d+), Col (\d+)/u.exec(text);
    expect(m, `в кадре нет позиции курсора:\n${text}`).not.toBeNull();
    return `${m![1]}:${m![2]}`;
}

describe("Find: навигация по совпадениям", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("F3 ищет дальше после закрытия виджета", async () => {
        const { session } = await useHeadlessApp({ files, open: ["notes.txt"], cols: 100, rows: 24 });
        await session.waitForText((t) => t.includes("gamma"));
        expect(await cursor(session)).toBe("1:1");

        // Обычный путь: Ctrl+F, запрос, Escape. Escape оставляет курсор на текущем
        // совпадении — первом «alpha» (строка 1).
        await session.key("Ctrl+F");
        await session.text("alpha");
        await session.key("Escape");
        expect(await cursor(session)).toBe("1:6");

        // Виджет закрыт — F3 всё равно шагает по последнему запросу.
        await session.key("F3");
        await session.waitForText((t) => /Ln 3, Col 6/u.test(t));
        expect(await cursor(session)).toBe("3:6");

        await session.key("F3");
        await session.waitForText((t) => /Ln 5, Col 6/u.test(t));

        // Shift+F3 возвращает назад.
        await session.key("Shift+F3");
        await session.waitForText((t) => /Ln 3, Col 6/u.test(t));
    }, 120_000);

    // Ctrl+Backspace доезжает только в CSI-u форме: легаси-байт 0x08 неотличим от
    // Ctrl+H, и бинд `ctrl+backspace` по нему не срабатывает.
    it("Ctrl+Backspace стирает слово в поле поиска", async () => {
        const { session } = await useHeadlessApp({ files, open: ["notes.txt"], cols: 100, rows: 24 });
        await session.waitForText((t) => t.includes("gamma"));

        await session.key("Ctrl+F");
        await session.text("alpha beta");
        await session.waitForText((t) => t.includes("alpha beta"));

        await session.key("Ctrl+Backspace");
        await session.waitForText((t) => t.includes("alpha ") && !t.includes("alpha beta"));
    }, 120_000);

    it("F3 без запроса берёт выделенное слово", async () => {
        const { session } = await useHeadlessApp({ files, open: ["notes.txt"], cols: 100, rows: 24 });
        await session.waitForText((t) => t.includes("gamma"));

        // Выделяем «alpha» в первой строке и ищем его же, не открывая виджет.
        for (let i = 0; i < 5; i++) await session.key("Shift+ArrowRight");
        await session.key("F3");

        await session.waitForText((t) => /Ln 3, Col 6/u.test(t));
    }, 120_000);
});
