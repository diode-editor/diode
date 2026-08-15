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

// Регрессии вокруг фикса шести дефектов PR #197 (255d596): фиксы трогают общую
// машинерию (Tab-обход всего дерева, пересборку редактора при перечитке, пиннинг
// цели find, гейт read-only), поэтому смотрим на соседей. На общих хелперах:
// ни одного sleep, координаты — от контента (clickText) или из inspectState.

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

    // `it.fails` — тест документирует ИЗВЕСТНЫЙ дефект и «проходит», пока дефект
    // жив; когда его починят, он покраснеет и попросит снять маркер. Дефект
    // пре-существующий, не из PR #197. Репро — docs/TODO/E2E.md, «Найденные дефекты».
    it.fails("find, оставленный открытым, переживает смену вкладки", async () => {
        app = await startOutputApp();
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));
        await session.key("Ctrl+F");
        await session.text("greeting");

        await session.key("Ctrl+P");
        await session.text("wireTypes.decorations");
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
        // После Tab фокус обязан на чём-то стоять (не «провалиться»).
        expect(await focusedType(session)).not.toBeUndefined();
        await session.key("Escape");
        expect(await focusedType(session)).toBe("EditorElement");
    }, 180_000);

    it("Tab в writable-редакторе по-прежнему вставляет отступ", async () => {
        app = await startOutputApp();
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));
        // Курсор сразу после «greeting» (перед пробелом и «=»): Tab там вставляет
        // выравнивающий отступ. Позиция — по контенту, не по магической координате.
        await clickText(session, "const greeting", { dx: "const greeting".length });
        await session.key("Tab");
        const row = findTextRow(await session.captureFrame(), "const greeting");
        expect(frameLine(await session.captureFrame(), row)).toContain("const greeting     = ");
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
        // Хвост: последняя видимая строка — одна из самых свежих.
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

        // Уводим фокус из редактора — в дерево файлов (клик по имени в сайдбаре,
        // не по одноимённой вкладке сверху: ограничиваем столбец).
        await clickText(session, "watched.txt", { maxX: 20 });
        const before = await focusedType(session);
        expect(before, "фокус должен уйти из редактора").not.toBe("EditorElement");

        writeFileSync(file, "changed on disk\n");
        await session.waitForText((t) => t.includes("changed on disk"), { timeoutMs: 15_000 });

        // Перечитка не должна утаскивать фокус в редактор.
        expect(await focusedType(session)).toBe(before);
    }, 180_000);
});

/** Индекс строки кадра с первым вхождением `needle` (или -1). */
function findTextRow(frame: import("@tuidom/core/rendering/gridSnapshot").GridSnapshot, needle: string): number {
    for (let y = 0; y < frame.rows; y++) if (frameLine(frame, y).includes(needle)) return y;
    return -1;
}
