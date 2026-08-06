import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { clickText } from "./outputPanel.shared.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Функциональный e2e панели Search (PR #209): чёрным ящиком через инспектор
// настоящего SEA-бинаря (он же распаковывает bundled `rg` в рантайме). Виджеты
// Search не имеют inspectState(), поэтому наблюдаем текст кадра + узел #search.
// Каждый it — одна гарантия из карты тестирования. Тестировщик, не автор PR.

const FILES = {
    "alpha.ts": "const Foo = 1;\nconst foobar = 2;\n// FOO here\n",
    "beta.txt": "foo appears here\nplain line\n",
    "sub/gamma.md": "## Foo heading\nfoobar again\n",
    "unicode.txt": "Привет Foo мир\n",
} as const;

const KEYS = [
    { key: "f6", command: "workbench.view.search" },
    { key: "f7", command: "workbench.view.explorer" },
    // Настоящая клавиша — Ctrl+Shift+J, e2e-DSL её не кодирует (как и Ctrl+Shift+F).
    { key: "f8", command: "workbench.action.search.toggleQueryDetails" },
];

async function openSearch(files: Record<string, string> = FILES): Promise<HeadlessApp> {
    const app = await useHeadlessApp({ files, keybindings: KEYS, cols: 100, rows: 30 });
    const { session } = app;
    await session.waitForText((t) => t.includes("EXPLORER"));
    await session.key("F6");
    await session.waitForText((t) => t.includes("SEARCH"));
    return app;
}

/** «N results in M files» из кадра, или null. */
function counts(text: string): { matches: number; files: number } | null {
    const m = /(\d+) results in (\d+) files?/u.exec(text);
    return m ? { matches: Number(m[1]), files: Number(m[2]) } : null;
}

describe("Search panel (functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    // ── B1 / A2 / C1: свап сайдбара, фокус, реальный поиск через rg ──────────
    it("свап Explorer→Search фокусирует строку запроса и ищет через rg", async () => {
        const app = await openSearch();
        const { session } = app;

        // Вид Search смонтирован (тело merged-контейнера, id="searchView"),
        // фокус — в input строки запроса.
        expect(await session.node("#searchView")).not.toBeNull();
        expect(await session.focusedType()).toBe("InputElement");

        await session.text("foo");
        await session.waitForText((t) => t.includes("results in"));
        const text = frameToText(await session.captureFrame());

        // Группировка по файлам (workspace-relative labels) + видимая строка-матч.
        expect(text).toContain("alpha.ts");
        expect(text).toContain("beta.txt");
        expect(text).toContain("sub/gamma.md");
        expect(text).toContain("foo appears here");

        // 4 файла из фикстуры содержат foo/Foo/FOO (case-insensitive по умолчанию).
        expect(counts(text)).toEqual({ matches: 7, files: 4 });
    }, 120_000);

    // ── C2 / C3: нет результатов и очистка запроса ──────────────────────────
    it("«No results» на отсутствующем запросе, пустой запрос очищает счётчик", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("zzqqxxnotathing");
        await session.waitForText((t) => t.includes("No results"));

        for (let i = 0; i < "zzqqxxnotathing".length; i++) await session.key("Backspace");
        // Пустой запрос: ни «results», ни «No results» — счётчик пуст.
        await session.waitForText((t) => !t.includes("No results") && !t.includes("results in"));
        const text = frameToText(await session.captureFrame());
        expect(text).not.toContain("No results");
        expect(text).not.toMatch(/results in/u);
    }, 120_000);

    // ── D1: тумблер Aa (case sensitivity) ───────────────────────────────────
    it("тумблер Aa делает поиск регистрозависимым", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("FOO");
        await session.waitForText((t) => t.includes("results in"));
        const before = counts(frameToText(await session.captureFrame()));
        expect(before).toEqual({ matches: 7, files: 4 });

        // Клик по глифу Aa в сайдбаре (maxX ограничивает левой панелью).
        await clickText(session, "Aa", { maxX: 40 });
        await session.waitForText((t) => {
            const c = counts(t);
            return c !== null && c.files === 1;
        });
        const after = counts(frameToText(await session.captureFrame()));
        // Точный регистр «FOO» есть только в комментарии alpha.ts.
        expect(after).toEqual({ matches: 1, files: 1 });
    }, 120_000);

    // ── D2: тумблер \b (whole word) ─────────────────────────────────────────
    it("тумблер \\b исключает подстроки (foo не матчит foobar)", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("foo");
        await session.waitForText((t) => t.includes("results in"));
        expect(frameToText(await session.captureFrame())).toContain("foobar");

        await clickText(session, "\\b", { maxX: 40 });
        // Целое слово: строки с foobar уходят, остаются standalone foo/Foo/FOO.
        await session.waitForText((t) => {
            const c = counts(t);
            return c !== null && c.matches === 5;
        });
        expect(frameToText(await session.captureFrame())).not.toContain("foobar");
    }, 120_000);

    // ── D3: тумблер .* (regex) + fixed-strings для литералов ─────────────────
    it("литеральный метасимвол ищется буквально, тумблер .* включает regex", async () => {
        const app = await openSearch();
        const { session } = app;

        // Без regex «F.o» — фиксированная строка, её нет в дереве.
        await session.text("F.o");
        await session.waitForText((t) => t.includes("No results"));

        // Включаем regex: «F.o» матчит Foo/FOO/foo(bar) по всему дереву.
        await clickText(session, ".*", { maxX: 40 });
        await session.waitForText((t) => t.includes("results in"));
        expect(counts(frameToText(await session.captureFrame()))?.matches).toBeGreaterThan(0);
    }, 120_000);

    // ── E1 / E2: include / exclude globs ────────────────────────────────────
    // Поля include/exclude спрятаны за «···» (Toggle Search Details; F8 здесь =
    // Ctrl+Shift+J) — раскрытие уводит фокус в include.
    it("include-glob сужает до .txt, exclude-glob убирает .ts", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("foo");
        await session.waitForText((t) => t.includes("results in"));

        // «···»: детали раскрылись, фокус в include. *.txt → beta.txt и unicode.txt.
        await session.key("F8");
        await session.waitForText((t) => t.includes("files to include"));
        await session.text("*.txt");
        await session.waitForText((t) => {
            const c = counts(t);
            return c !== null && c.files === 2;
        });
        let text = frameToText(await session.captureFrame());
        expect(text).toContain("beta.txt");
        expect(text).toContain("unicode.txt");
        expect(text).not.toContain("alpha.ts");
        expect(text).not.toContain("sub/gamma.md");

        // Убираем include, Tab → exclude, ставим *.ts → alpha.ts исчезает.
        for (let i = 0; i < "*.txt".length; i++) await session.key("Backspace");
        await session.key("Tab");
        await session.text("*.ts");
        await session.waitForText((t) => {
            const c = counts(t);
            return c !== null && c.files === 3;
        });
        text = frameToText(await session.captureFrame());
        expect(text).not.toContain("alpha.ts");
        expect(text).toContain("beta.txt");
        expect(text).toContain("sub/gamma.md");
    }, 120_000);

    // ── Клик мышью фокусирует поля Search (регресс на баг клик-фокуса) ────────
    // Раньше query фокусировался только программно при открытии, а клик по любому
    // из трёх input-полей фокус не переносил (include/exclude мышью недостижимы).
    // Фикс — InputElement.performDefaultAction делегирует mousedown базовому
    // фокусу. Клик по include уводит туда ввод, а строка запроса остаётся "foo".
    it("клик по полю include фокусирует его, ввод уходит туда, а не в query", async () => {
        const app = await openSearch();
        const { session } = app;
        await session.text("foo");
        await session.waitForText((t) => t.includes("results in"));

        // Раскрыть детали и вернуть фокус в строку запроса (F6 = show search),
        // чтобы фокус в include пришёл именно от клика.
        await session.key("F8");
        await session.waitForText((t) => t.includes("files to include"));
        await session.key("F6");

        await clickText(session, "files to include", { maxX: 60 });
        await session.text("XX");
        const text = frameToText(await session.captureFrame());
        // XX ушёл в поле include (его плейсхолдер сменился на введённый текст), а
        // строка запроса осталась "foo" — клик перенёс фокус.
        expect(text).not.toContain("fooXX");
        expect(text).not.toContain("files to include");
        expect(text).toContain("XX");
    }, 120_000);

    // ── F1: байтовые смещения → колонки, целостность превью на кириллице ─────
    it("превью не бьётся на не-ASCII строке (byte offsets)", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("Foo");
        await session.waitForText((t) => t.includes("results in"));
        const text = frameToText(await session.captureFrame());
        // before='Привет ' inside='Foo' after=' мир' — при верном байт-сплите
        // строка на экране целая, без обрезки кириллицы.
        expect(text).toContain("unicode.txt");
        expect(text).toContain("Привет Foo мир");
    }, 120_000);

    // ── B2: возврат к Explorer ──────────────────────────────────────────────
    it("workbench.view.explorer возвращает Explorer в сайдбар", async () => {
        const app = await openSearch();
        const { session } = app;
        await session.key("F7");
        await session.waitForText((t) => t.includes("EXPLORER"));
        expect(await session.node("#searchView")).toBeNull();
    }, 120_000);
});
