import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import {
    findWidgetLine,
    focusedEditorState,
    focusedType,
    focusLogBody,
    openOutput,
    outputEditor,
    pickChannel,
    startOutputApp,
    waitForPanelPersisted,
} from "./outputPanel.shared.ts";

// Функциональные тесты панели Output (PR #197) на общих хелперах: чёрным ящиком
// через инспектор настоящего бинаря, без sleep и координат-литералов. Каждый
// `it` — одна гарантия или один дефект из ревью. Помеченные `[BUG-n]` падали на
// head PR до фикса (cda7424).

describe("Output panel (functional e2e)", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    // ── Заявленное поведение ────────────────────────────────────────────────

    it("открывает вкладку OUTPUT между PROBLEMS и TERMINAL с непустым логом", async () => {
        app = await startOutputApp();
        await openOutput(app.session);
        const panel = await app.session.node("PanelContainerElement");
        const tabs = (panel?.state?.tabs ?? []) as { id: string; title: string }[];
        expect(tabs.map((t) => t.title)).toEqual(["PROBLEMS", "OUTPUT", "TERMINAL"]);
        const text = frameToText(await app.session.captureFrame());
        expect(text).toMatch(/\d\d:\d\d:\d\d\.\d\d\d \[info\] diode starting/u);
    }, 120_000);

    it("переключает канал мышью через селектор — меняется и контент, и подпись", async () => {
        app = await startOutputApp();
        await openOutput(app.session);
        await pickChannel(app.session, "Extensions");
        const select = await app.session.node("SelectBoxElement");
        expect(select?.state?.selectedText).toMatch(/Extensions/u);
        expect(frameToText(await app.session.captureFrame())).not.toContain("diode starting");
    }, 120_000);

    it("клик по селектору не переключает вкладку панели, клики по табам работают", async () => {
        app = await startOutputApp();
        const { session } = app;
        await openOutput(session);

        // Клик по селектору раскрывает список, но активной остаётся вкладка OUTPUT.
        await session.clickNode("SelectBoxElement");
        await session.waitForNode("PopupMenuElement");
        expect(await activeTab(session)).toBe("OUTPUT");
        await session.key("Escape");
        await session.waitForNoNode("PopupMenuElement");

        // Уходим на PROBLEMS (не TERMINAL: тот спавнит настоящий PTY) — селектор исчезает.
        await clickTab(session, "PROBLEMS");
        await session.waitForNoNode("SelectBoxElement");
        expect(await activeTab(session)).toBe("PROBLEMS");

        // Назад на OUTPUT — селектор возвращается.
        await clickTab(session, "OUTPUT");
        await session.waitForNode("SelectBoxElement");
    }, 120_000);

    // ── Дефекты ─────────────────────────────────────────────────────────────

    it("[BUG-1] после смены канала мышью фокус не теряется", async () => {
        app = await startOutputApp();
        const { session } = app;
        await openOutput(session);
        expect(await focusedType(session)).toBe("EditorElement");

        await pickChannel(session, "Extensions");
        // Фактически до фикса: focusedLeaf === null, ввод «проваливался».
        expect(await focusedType(session)).toBe("EditorElement");
    }, 120_000);

    it("[BUG-1b] смена канала командой (кейбинд) тоже не роняет фокус", async () => {
        app = await startOutputApp();
        const { session } = app;
        await openOutput(session);
        await session.key("Alt+J"); // workbench.action.output.show.extensions
        await session.waitForText((t) => t.includes("Extensions"));
        expect(await focusedType(session)).toBe("EditorElement");
    }, 120_000);

    it("[BUG-2] Toggle Read-only при фокусе в Output не делает лог редактируемым", async () => {
        app = await startOutputApp();
        const { session } = app;
        await openOutput(session);
        await focusLogBody(session);
        expect((await outputEditor(session)).state?.readOnly).toBe(true);

        await session.key("Alt+R"); // toggleActiveEditorReadonlyInSession
        await session.key("Alt+R"); // повторно — снова settle; проверяем итог
        // Лог обязан остаться read-only, ввод не должен просочиться.
        await session.text("HACKED");
        expect((await outputEditor(session)).state?.readOnly).toBe(true);
        expect(frameToText(await session.captureFrame())).not.toContain("HACKED");
    }, 120_000);

    it("[BUG-3] живой канал не рвёт выделение в Output", async () => {
        app = await startOutputApp();
        const { session } = app;
        await openOutput(session);

        // Выделяем от начала лога вниз (Ctrl+Home → строка 0 с текстом; вниз —
        // выделение в верхней, стабильной части, не зависящей от длины канала и
        // от автоскролла к хвосту).
        // Контроль: статичный канал Bootstrap — выделение живёт.
        await pickChannel(session, "Bootstrap");
        await focusLogBody(session);
        await session.key("Ctrl+Home");
        for (let i = 0; i < 2; i++) await session.key("Shift+ArrowDown");
        expect((await focusedEditorState(session))?.hasSelection).toBe(true);

        // Опыт: живой канал Keybindings (пишет на каждый keydown) — до фикса
        // revealLastLine схлопывал выделение на каждой записи.
        await pickChannel(session, "Keybindings");
        await focusLogBody(session);
        await session.key("Ctrl+Home");
        for (let i = 0; i < 2; i++) await session.key("Shift+ArrowDown");
        expect((await focusedEditorState(session))?.hasSelection).toBe(true);
    }, 180_000);

    it("[BUG-4] Ctrl+F при фокусе в Output ищет по логу, а не по файлу за панелью", async () => {
        app = await startOutputApp();
        const { session } = app;
        await openOutput(session);
        await focusLogBody(session);

        await session.key("Ctrl+F");
        // "starting" есть в логе (`[info] diode starting`) и отсутствует в sample.ts.
        await session.text("starting");
        const findLine = await session.waitForText(
            (t) => t.split("\n").some((l) => l.includes("[ ↑ ]")),
            {},
        ).then((f) => findWidgetLine(f));
        // Фактически до фикса: "No results" — искали по sample.ts.
        expect(findLine).not.toContain("No results");
    }, 120_000);

    it("[BUG-5] Tab в read-only редакторе не уводит фокус в невидимый виджет", async () => {
        app = await startOutputApp();
        const { session } = app;
        await openOutput(session);
        await focusLogBody(session);
        await session.key("Tab");
        // Фактически до фикса: QuickPickElement из OverlayLayer ловил ввод.
        expect(await focusedType(session)).not.toBe("QuickPickElement");
    }, 120_000);

    it("[BUG-6] после рестарта с открытой вкладкой OUTPUT лог виден сразу", async () => {
        const first = await startOutputApp({ keepRoot: true });
        const root = first.env.root;
        try {
            await openOutput(first.session);
            // Ждём, пока debounce StateService запишет видимость панели на диск —
            // иначе рестарт её не восстановит (async-хвост, не покрывается idle).
            await waitForPanelPersisted(root);
        } finally {
            await first.session.dispose(); // корень НЕ удаляем (keepRoot)
        }

        app = await startOutputApp({ root, keepRoot: false });
        await app.session.waitForText((t) => t.includes("greeting"), { timeoutMs: 30_000 });
        // Восстановление панели после рестарта — тяжёлый путь (второй boot);
        // под нагрузкой параллельного прогона даём запас по времени.
        const text = await app.session
            .waitForText((t) => t.includes("OUTPUT") && !t.includes("No output yet."), { timeoutMs: 30_000 })
            .then(frameToText);
        // Фактически до фикса: "No output yet." — контент не создавался до активации вкладки.
        expect(text).toMatch(/\[info\] diode starting/u);
    }, 180_000);
});

/** Кликает вкладку нижней панели по подписи — координаты из inspectState. */
async function clickTab(session: import("./helpers/headlessSession.ts").HeadlessSession, title: string): Promise<void> {
    const panel = await session.node("PanelContainerElement");
    const tabs = (panel?.state?.tabs ?? []) as { title: string; centerX: number }[];
    const tabRow = panel?.state?.tabRow as number;
    const tab = tabs.find((t) => t.title === title);
    if (tab === undefined) throw new Error(`tab "${title}" not found: ${JSON.stringify(tabs)}`);
    await session.click(tab.centerX, tabRow);
}

/** Подпись активной вкладки нижней панели. */
async function activeTab(session: import("./helpers/headlessSession.ts").HeadlessSession): Promise<string | undefined> {
    const panel = await session.node("PanelContainerElement");
    const tabs = (panel?.state?.tabs ?? []) as { title: string; active: boolean }[];
    return tabs.find((t) => t.active)?.title;
}
