import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { clickText } from "./outputPanel.shared.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Виджеты Search не имеют inspectState() — наблюдаем текст кадра и узел #search.

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

function counts(text: string): { matches: number; files: number } | null {
    const m = /(\d+) results in (\d+) files?/u.exec(text);
    return m ? { matches: Number(m[1]), files: Number(m[2]) } : null;
}

describe("Search panel (functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("свап Explorer→Search фокусирует строку запроса и ищет через rg", async () => {
        const app = await openSearch();
        const { session } = app;

        expect(await session.node("#searchView")).not.toBeNull();
        expect(await session.focusedType()).toBe("InputElement");

        await session.text("foo");
        await session.waitForText((t) => t.includes("results in"));
        const text = frameToText(await session.captureFrame());

        expect(text).toContain("alpha.ts");
        expect(text).toContain("beta.txt");
        expect(text).toContain("sub/gamma.md");
        expect(text).toContain("foo appears here");

        // 4 файла из фикстуры содержат foo/Foo/FOO (case-insensitive по умолчанию).
        expect(counts(text)).toEqual({ matches: 7, files: 4 });
    }, 120_000);

    it("«No results» на отсутствующем запросе, пустой запрос очищает счётчик", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("zzqqxxnotathing");
        await session.waitForText((t) => t.includes("No results"));

        for (let i = 0; i < "zzqqxxnotathing".length; i++) await session.key("Backspace");
        await session.waitForText((t) => !t.includes("No results") && !t.includes("results in"));
        const text = frameToText(await session.captureFrame());
        expect(text).not.toContain("No results");
        expect(text).not.toMatch(/results in/u);
    }, 120_000);

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

    it("тумблер \\b исключает подстроки (foo не матчит foobar)", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("foo");
        await session.waitForText((t) => t.includes("results in"));
        expect(frameToText(await session.captureFrame())).toContain("foobar");

        await clickText(session, "\\b", { maxX: 40 });
        await session.waitForText((t) => {
            const c = counts(t);
            return c !== null && c.matches === 5;
        });
        expect(frameToText(await session.captureFrame())).not.toContain("foobar");
    }, 120_000);

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

    // Поля include/exclude — за «···» (F8 здесь = Ctrl+Shift+J); раскрытие уводит фокус в include.
    it("include-glob сужает до .txt, exclude-glob убирает .ts", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("foo");
        await session.waitForText((t) => t.includes("results in"));

        // *.txt → beta.txt и unicode.txt.
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
        expect(text).not.toContain("fooXX");
        expect(text).not.toContain("files to include");
        expect(text).toContain("XX");
    }, 120_000);

    it("превью не бьётся на не-ASCII строке (byte offsets)", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("Foo");
        await session.waitForText((t) => t.includes("results in"));
        const text = frameToText(await session.captureFrame());
        // before='Привет ' inside='Foo' after=' мир' — при верном байт-сплите строка целая.
        expect(text).toContain("unicode.txt");
        expect(text).toContain("Привет Foo мир");
    }, 120_000);

    it("workbench.view.explorer возвращает Explorer в сайдбар", async () => {
        const app = await openSearch();
        const { session } = app;
        await session.key("F7");
        await session.waitForText((t) => t.includes("EXPLORER"));
        expect(await session.node("#searchView")).toBeNull();
    }, 120_000);
});
