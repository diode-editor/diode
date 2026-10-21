import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { startHeadlessApp, type HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameLine, frameToText } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import {
    clickText,
    findWidgetLine,
    focusedType,
    openOutput,
    OUTPUT_KEYBINDINGS,
    pickChannel,
    startOutputApp,
} from "./outputPanel.shared.ts";

// Фиксы шести дефектов PR #197 (255d596) трогают общую машинерию: Tab-обход дерева,
// пересборку редактора при перечитке, пиннинг цели find, гейт read-only — смотрим на соседей.

describe("Output panel fix — регрессии соседних механизмов", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    const findRow = async (session: HeadlessSession): Promise<string> =>
        findWidgetLine(await session.captureFrame()).trim();

    it("find после пиннинга следует за вкладкой: закрыть → сменить вкладку → Ctrl+F ищет по новой", async () => {
        app = await startOutputApp();
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));

        // Сессия 1 — по sample.ts.
        await session.key("Ctrl+F");
        await session.text("greeting");
        expect(await findRow(session)).toContain("of");
        await session.key("Escape");

        // Открываем второй файл и ищем то, чего в первом нет.
        await session.key("Ctrl+P");
        await session.text("wireTypes.decorations");
        await session.key("Enter");
        await session.waitForText((t) => t.includes("wireTypes"));

        await session.key("Ctrl+F");
        await session.text("decoration");
        // Если бы цель залипла на первой вкладке — было бы "No results".
        expect(await findRow(session)).not.toContain("No results");
    }, 180_000);

    /**
     * `it.fails` документирует известный дефект (не из #197; репро — docs/TODO/E2E.md):
     * починят — покраснеет и попросит снять маркер. Воркспейс — герметичная папка, а не
     * repoRoot: дефект — гонка фокуса, и на большом репозитории фоновый шум (LSP, git,
     * сборка в `dist/`) давал флейк в обе стороны.
     */
    it.fails("find, оставленный открытым, переживает смену вкладки", async () => {
        const workspace = mkdtempSync(join(tmpdir(), "diode-find-focus-"));
        const first = join(workspace, "alpha.ts");
        writeFileSync(first, "export const greeting = 'привет';\n");
        writeFileSync(join(workspace, "beta.ts"), "export const decoration = 42;\n");
        app = await startHeadlessApp({ cols: 120, rows: 32, open: [workspace, first], cwd: workspace });
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));
        await session.key("Ctrl+F");
        await session.text("greeting");

        await session.key("Ctrl+P");
        await session.text("beta");
        await session.key("Enter");
        await session.key("Escape");

        // Приложение живо; ввод должен дойти до видимого редактора.
        expect((await session.getDocument()).root).not.toBeNull();
        await session.text("REG");
        expect(frameToText(await session.captureFrame())).toContain("REG");
    }, 180_000);

    it("Tab внутри открытого find-виджета остаётся внутри виджета", async () => {
        app = await startOutputApp();
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));
        await session.key("Ctrl+F");
        expect(await focusedType(session)).toBe("InputElement");
        await session.key("Tab");
        expect(await focusedType(session)).not.toBeUndefined();
        await session.key("Escape");
        expect(await focusedType(session)).toBe("EditorElement");
    }, 180_000);

    it("Tab в writable-редакторе по-прежнему вставляет отступ", async () => {
        app = await startOutputApp();
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));
        // Курсор сразу после «greeting»: Tab там вставляет выравнивающий отступ.
        await clickText(session, "const greeting", { dx: "const greeting".length });
        await session.key("Tab");
        const row = findTextRow(await session.captureFrame(), "const greeting");
        // Каретка на видимой колонке 14, tabSize 4 (детекция по фикстуре) → два
        // пробела ДО табстопа 16, а не четыре: Tab выравнивает по табстопам.
        expect(frameLine(await session.captureFrame(), row)).toContain("const greeting   = ");
        expect(await focusedType(session)).toBe("EditorElement");
    }, 180_000);

    it("read-only на обычной вкладке всё ещё переключается", async () => {
        app = await startOutputApp();
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));
        await clickText(session, "const greeting", { dx: "const ".length });

        await session.key("Alt+R"); // toggleActiveEditorReadonlyInSession
        expect(frameLine(await session.captureFrame(), 1)).toContain("\uea75"); // nf-cod-lock на вкладке
        await session.text("NOPE");
        expect(frameToText(await session.captureFrame())).not.toContain("NOPE");

        await session.key("Alt+R"); // снимаем read-only
        expect(frameLine(await session.captureFrame(), 1)).not.toContain("\uea75");
        await session.text("YES");
        expect(frameToText(await session.captureFrame())).toContain("YES");
    }, 180_000);

    it("живой хвост Output следует за логом, когда курсор в конце", async () => {
        app = await startOutputApp();
        const { session } = app;
        await openOutput(session);
        await pickChannel(session, "Keybindings");

        // Набиваем лог сильно больше высоты панели и смотрим, что видно последнее.
        for (let i = 0; i < 20; i++) await session.key("ArrowRight");
        const f = await session.captureFrame();
        const lineNos: number[] = [];
        for (let y = 21; y <= 29; y++) {
            const m = /^\s*(\d+)\s+\d\d:\d\d:\d\d/u.exec(frameLine(f, y).slice(32));
            if (m !== null) lineNos.push(Number(m[1]));
        }
        expect(lineNos.length, "в панели должны быть видны строки лога").toBeGreaterThan(0);
        expect(Math.max(...lineNos)).toBeGreaterThan(15);
    }, 180_000);

    it("перечитка файла с диска не крадёт фокус, если пользователь не в редакторе", async () => {
        const dir = mkdtempSync(join(tmpdir(), "diode-reload-"));
        const file = join(dir, "watched.txt");
        writeFileSync(file, "original line\n");

        app = await startHeadlessApp({
            cols: 120,
            rows: 32,
            keybindings: OUTPUT_KEYBINDINGS,
            open: [dir, file],
            cwd: dir,
        });
        const { session } = app;
        await session.waitForText((t) => t.includes("original line"));

        // Фокус — в дерево файлов; `maxX` — чтобы не попасть в одноимённую вкладку сверху.
        await clickText(session, "watched.txt", { maxX: 20 });
        const before = await focusedType(session);
        expect(before, "фокус должен уйти из редактора").not.toBe("EditorElement");

        writeFileSync(file, "changed on disk\n");
        await session.waitForText((t) => t.includes("changed on disk"), { timeoutMs: 15_000 });

        expect(await focusedType(session)).toBe(before);
    }, 180_000);
});

/** -1 — не нашлось. */
function findTextRow(frame: import("@tuidom/core/rendering/gridSnapshot").GridSnapshot, needle: string): number {
    for (let y = 0; y < frame.rows; y++) if (frameLine(frame, y).includes(needle)) return y;
    return -1;
}
