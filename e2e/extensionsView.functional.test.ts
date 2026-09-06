import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Функциональный e2e магазина расширений: настоящий бинарь, вьюлет EXTENSIONS,
 * страница расширения. Реестр — **файловая фикстура** (`--registry <dir>`),
 * поэтому прогон герметичен: сеть проверяет отдельный сьют `e2e/marketplace/`,
 * который ставит реально опубликованное.
 *
 * Фикстура подобрана под состояния карточек: `acme.sample` не установлен,
 * `test.tab-setter` установлен версией 0.0.1 при реестровой 0.0.2 (обновление),
 * `old.legacy` требует `vscode ^99` (несовместимо).
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const REGISTRY = resolve(here, "fixtures", "registry");
const USER_DATA = resolve(here, "fixtures", "user-data-with-tab-setter");

/** F6 — вьюлет магазина: настоящий Ctrl+Shift+X e2e-DSL не кодирует. */
const KEYS = [{ key: "f6", command: "workbench.view.extensions" }];

async function openExtensions(options: { registry?: string } = {}): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        seedUserData: USER_DATA,
        files: { "hello.txt": "hello\n" },
        extraArgs: [`--registry=${options.registry ?? REGISTRY}`],
        keybindings: KEYS,
        cols: 110,
        rows: 30,
    });
    await app.session.waitForText((t) => t.includes("EXPLORER"));
    await app.session.key("F6");
    await app.session.waitForText((t) => t.includes("EXTENSIONS"));
    return app;
}

/** Метки вкладок редактора — идентичность страницы проверяется по ним. */
async function tabLabels(app: HeadlessApp): Promise<string[]> {
    const strip = await app.session.node("EditorTabStripElement");
    const state = strip?.state as { tabs?: { label: string }[] } | undefined;
    return (state?.tabs ?? []).map((t) => t.label);
}

/** Текст строки списка по её id — не зависит от ширины сайдбара, в отличие от кадра. */
async function rowText(app: HeadlessApp, id: string): Promise<string> {
    const row = await app.session.node(`#${id}`);
    expect(row, `строка #${id} не найдена`).not.toBeNull();
    return row?.text ?? "";
}

describe("Extensions view (functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("US-1: команда показа открывает вьюлет со строкой поиска и обеими секциями", async () => {
        const app = await openExtensions();
        const screen = frameToText(await app.session.captureFrame());

        expect(screen).toContain("EXTENSIONS");
        expect(screen).toContain("Search Extensions");
        expect(screen).toContain("MARKETPLACE");
        expect(screen).toContain("INSTALLED");
        expect(screen).toContain("Acme Sample");
    });

    it("US-4/5/6: бейджи установленного, обновления и несовместимости", async () => {
        const app = await openExtensions();
        // Сайдбар узкий — в кадре бейдж обрезан, поэтому читаем текст строки:
        // от ширины панели он не зависит.
        expect(await rowText(app, "extensionsGroup-marketplace-acme-sample")).toBe("Acme Sample  1.2.0");
        expect(await rowText(app, "extensionsGroup-marketplace-test-tab-setter")).toBe("Tab Setter  0.0.1  Update 0.0.2");
        expect(await rowText(app, "extensionsGroup-installed-test-tab-setter")).toBe("Tab Setter  0.0.1  Update 0.0.2");
        expect(await rowText(app, "extensionsGroup-marketplace-old-legacy")).toBe("Legacy Thing  3.0.0  Incompatible");
    });

    it("US-2: фильтр по мере ввода оставляет только совпавшие записи", async () => {
        const app = await openExtensions();
        await app.session.text("acme");
        await app.session.waitForNoNode("#extensionsGroup-marketplace-old-legacy");

        const screen = frameToText(await app.session.captureFrame());
        expect(screen).toContain("Acme Sample");
        expect(screen).not.toContain("Legacy Thing");
    });

    it("US-3: не нашлось — пустое состояние", async () => {
        const app = await openExtensions();
        await app.session.text("zzzz");
        await app.session.waitForText((t) => t.includes("No extensions found"));
    });

    it("US-8: Enter на записи открывает страницу расширения с readme", async () => {
        const app = await openExtensions();
        await app.session.text("acme");
        await app.session.waitForText((t) => t.includes("Acme Sample"));
        await app.session.key("Tab");
        await app.session.key("ArrowDown");
        await app.session.key("Enter");

        await app.session.waitForText((t) => t.includes("This readme comes from the registry meta"));
        const screen = frameToText(await app.session.captureFrame());
        expect(screen).toContain("Not installed");
        expect(screen).toContain("Latest version: 1.2.0");
        expect(screen).toContain("Kind: native");
    });

    it("US-9: повторное открытие переключает на ту же вкладку, второй не заводит", async () => {
        const app = await openExtensions();
        await app.session.text("acme");
        await app.session.waitForText((t) => t.includes("Acme Sample"));
        await app.session.key("Tab");
        await app.session.key("ArrowDown");
        await app.session.key("Enter");
        await app.session.waitForNode("#extensionPage-acme-sample");
        expect(await tabLabels(app)).toEqual(["Acme Sample"]);

        // Вернуться в список и открыть ту же запись ещё раз.
        await app.session.key("F6");
        await app.session.key("Tab");
        await app.session.key("ArrowDown");
        await app.session.key("Enter");
        await app.session.waitForNode("#extensionPage-acme-sample");

        // Вкладка одна: идентичность панели — её uri (`extension:acme.sample`),
        // повторное открытие переключает на существующую.
        expect(await tabLabels(app)).toEqual(["Acme Sample"]);
    });

    it("US-18/20: недоступный реестр — причина и повтор, установленные видны", async () => {
        const app = await openExtensions({ registry: resolve(here, "fixtures", "registry-missing") });
        await app.session.waitForText((t) => t.includes("Retry"));

        const screen = frameToText(await app.session.captureFrame());
        // Причина сбоя — не «fetch failed», а текст с путём/кодом ошибки.
        expect(screen).toContain("Retry");
        expect(screen).toContain("INSTALLED");
        expect(screen).toContain("Tab Setter");
    });
});
