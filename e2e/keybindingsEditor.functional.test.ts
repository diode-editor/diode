import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Функциональный e2e вкладки Keyboard Shortcuts: настоящий бинарь, открытие
 * вкладки, запись биндинга рекордером с проверкой файла на диске и исполнения
 * команды по новой комбинации в том же сеансе (урок #194 — тест доходит до
 * наблюдаемого результата, а не до шва).
 *
 * `keybindings.json` засеян заранее конфликтным правилом, чтобы демонстрировать
 * фильтр @conflicts. Открытие вкладки — F6-биндом: настоящий Ctrl+K Ctrl+S
 * e2e-DSL надёжно не кодирует (как F6 у extensions-сценария).
 */

const KEYS = [
    { key: "f6", command: "workbench.action.openGlobalKeybindings" },
    // Заранее конфликтный пользовательский бинд на ту же комбинацию, что дефолтный save.
    { key: "ctrl+s", command: "editor.action.selectAll" },
];

function keybindingsFile(app: HeadlessApp): string {
    return join(app.env.userDataDir, "user-data", "User", "keybindings.json");
}

async function openEditor(): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        files: { "hello.txt": "hello\n" },
        keybindings: KEYS,
        cols: 110,
        rows: 32,
    });
    await app.session.waitForText((t) => t.includes("EXPLORER"));
    await app.session.key("F6");
    await app.session.waitForText((t) => t.includes("Keyboard Shortcuts") && t.includes("Keybinding"));
    return app;
}

describe("Keyboard Shortcuts editor (functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("US-1: команда открывает вкладку со списком команд и колонками", async () => {
        const app = await openEditor();
        const screen = frameToText(await app.session.captureFrame());

        expect(screen).toContain("Keyboard Shortcuts");
        expect(screen).toContain("Command");
        expect(screen).toContain("Keybinding");
        expect(screen).toContain("Source");
        expect(screen).toContain("Type to search keybindings");
    });

    it("US-2: поиск фильтрует список", async () => {
        const app = await openEditor();
        await app.session.text("Save File");
        const screen = frameToText(await app.session.waitForText((t) => t.includes("Save File")));

        expect(screen).toContain("Save File");
        expect(screen).not.toContain("Toggle Line Comment");
    });

    it("US-3: рекордер пишет биндинг — файл на диске и команда работает в этом сеансе", async () => {
        const app = await openEditor();

        // Отфильтровать до конкретной команды и активировать её строку.
        await app.session.text("Show Hover");
        await app.session.waitForText((t) => t.includes("Show Hover"));
        const row = await app.session.node("#kb-0");
        expect(row, "строка команды не найдена").not.toBeNull();
        await app.session.clickNode("#kb-0");
        await app.session.clickNode("#kb-0"); // двойной клик → рекордер
        await app.session.waitForText((t) => t.includes("Press desired key combination"));

        // Записать F9 и принять.
        await app.session.key("F9");
        await app.session.key("Enter");

        await app.session.waitForText((t) => t.includes("F9"));
        const written = readFileSync(keybindingsFile(app), "utf-8");
        expect(written).toContain('"key": "f9"');
        expect(written).toContain('"command": "editor.action.showHover"');
    });

    it("US-4: @conflicts показывает заранее конфликтную пару на Ctrl+S", async () => {
        const app = await openEditor();
        await app.session.text("@conflicts ctrl+s");
        const screen = frameToText(await app.session.waitForText((t) => t.includes("Select All")));

        // Дефолтный save и пользовательский selectAll делят Ctrl+S — оба в выдаче.
        expect(screen).toContain("Select All");
        expect(screen).toContain("Save");
    });
});
