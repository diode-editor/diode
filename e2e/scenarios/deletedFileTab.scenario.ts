import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell, frameLine } from "../helpers/frame.ts";

import { defineScenario } from "./framework.ts";

// Удаление каталога из проводника идёт в корзину мимо файлового сервиса: чистая вкладка файла внутри
// закрывается (как в VS Code), а вкладка с несохранёнными правками остаётся зачёркнутой.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-deleted-tab-demo-"));
// Корзина freedesktop — во временном каталоге, а не в домашнем у того, кто гоняет e2e.
const dataHome = mkdtempSync(join(tmpdir(), "diode-deleted-tab-xdg-"));
const notes = join(sampleDir, "notes.txt");
const clean = join(sampleDir, "src", "clean.txt");
const dirty = join(sampleDir, "src", "dirty.txt");

/** `StyleFlags.Strikethrough` движка. */
const STRIKETHROUGH = 32;

function tabRow(text: string): string {
    return text.split("\n").find((line) => line.includes("notes.txt") && line.includes("dirty.txt")) ?? "";
}

function isStruck(frame: GridSnapshot, needle: string): boolean {
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`«${needle}» нет в кадре`);
    return (frame.cells[cell.y * frame.cols + cell.x].style & STRIKETHROUGH) !== 0;
}

export default defineScenario({
    name: "deleted-file-tab",
    title: "Вкладка удалённого файла: зачёркнута и «(deleted)», чистая из удалённого каталога закрывается",
    open: [sampleDir, notes, clean, dirty],
    cols: 120,
    rows: 20,
    env: { XDG_DATA_HOME: dataHome },
    // Без диалога подтверждения: удаление в корзину отменяемо.
    settings: { "explorer.confirmDelete": false },
    // Корзина freedesktop есть только на Linux; на остальных проводник удалил бы
    // безвозвратно — это тот же путь через файловый сервис, что и unit-тесты.
    skipOn: ["win32", "darwin"],
    async prepare() {
        mkdirSync(join(sampleDir, "src"), { recursive: true });
        writeFileSync(notes, "Project notes.\n");
        writeFileSync(clean, "clean file\n");
        writeFileSync(dirty, "dirty file\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("dirty file") && tabRow(t).includes("clean.txt"));
        // Активна последняя открытая вкладка — dirty.txt: несохранённая правка.
        await editor.sendText("edited ");
        await editor.waitForText((t) => t.includes("edited dirty file"));

        // ── Внешнее удаление: вкладка остаётся зачёркнутой ──
        rmSync(notes);
        const deleted = await editor.waitForText((t) => tabRow(t).includes("notes.txt (deleted)"), {
            timeoutMs: 10_000,
        });
        if (!isStruck(deleted, "notes.txt (deleted)")) throw new Error("имя удалённого файла не зачёркнуто");
        await editor.capture("external-delete");

        // ── Файл вернулся: флаг снят ──
        writeFileSync(notes, "Project notes, restored.\n");
        const restored = await editor.waitForText((t) => tabRow(t) !== "" && !tabRow(t).includes("(deleted)"), {
            timeoutMs: 10_000,
        });
        if (isStruck(restored, "notes.txt")) throw new Error("вернувшийся файл остался зачёркнутым");
        await editor.capture("restored");

        // ── Удаление каталога src из проводника ──
        // Фокус в дерево через меню View (как в сценарии rename-open-file),
        // Home — первая строка, каталог src (каталоги идут первыми).
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Explorer"));
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.sendKey("Home");
        await editor.sendKey("Delete");

        // Чистая clean.txt закрылась, «грязная» dirty.txt осталась зачёркнутой.
        const afterFolder = await editor.waitForText(
            (t) => t.includes("dirty.txt (deleted)") && !t.includes("clean.txt"),
            { timeoutMs: 10_000 },
        );
        if (!isStruck(afterFolder, "dirty.txt (deleted)")) throw new Error("грязная вкладка не зачёркнута");
        const row = findTextCell(afterFolder, "dirty.txt (deleted)");
        if (row !== null && !frameLine(afterFolder, row.y).includes("notes.txt")) {
            throw new Error("вкладка notes.txt пропала вместе с каталогом src");
        }
        await editor.capture("folder-delete");
    },
});
