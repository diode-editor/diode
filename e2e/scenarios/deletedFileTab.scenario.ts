import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell, frameLine } from "../helpers/frame.ts";

import { defineScenario } from "./framework.ts";

// Deleting a folder from the explorer moves it to the trash, bypassing the file service: a clean tab for a file
// inside closes (as in VS Code), while a tab with unsaved edits stays struck through.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-deleted-tab-demo-"));
// The freedesktop trash lives in a temp directory, not in the home of whoever runs e2e.
const dataHome = mkdtempSync(join(tmpdir(), "diode-deleted-tab-xdg-"));
const notes = join(sampleDir, "notes.txt");
const clean = join(sampleDir, "src", "clean.txt");
const dirty = join(sampleDir, "src", "dirty.txt");

/** The engine's `StyleFlags.Strikethrough`. */
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
    // No confirmation dialog: moving to the trash can be undone.
    settings: { "explorer.confirmDelete": false },
    // The freedesktop trash exists only on Linux; elsewhere the explorer would delete
    // permanently, which is the same file-service path the unit tests cover.
    skipOn: ["win32", "darwin"],
    async prepare() {
        mkdirSync(join(sampleDir, "src"), { recursive: true });
        writeFileSync(notes, "Project notes.\n");
        writeFileSync(clean, "clean file\n");
        writeFileSync(dirty, "dirty file\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("dirty file") && tabRow(t).includes("clean.txt"));
        // The last opened tab, dirty.txt, is active and holds an unsaved edit.
        await editor.sendText("edited ");
        await editor.waitForText((t) => t.includes("edited dirty file"));

        // ── External deletion: the tab stays struck through ──
        rmSync(notes);
        const deleted = await editor.waitForText((t) => tabRow(t).includes("notes.txt (deleted)"), {
            timeoutMs: 10_000,
        });
        if (!isStruck(deleted, "notes.txt (deleted)")) throw new Error("имя удалённого файла не зачёркнуто");
        await editor.capture("external-delete");

        // ── File restored: the flag is cleared ──
        writeFileSync(notes, "Project notes, restored.\n");
        const restored = await editor.waitForText((t) => tabRow(t) !== "" && !tabRow(t).includes("(deleted)"), {
            timeoutMs: 10_000,
        });
        if (isStruck(restored, "notes.txt")) throw new Error("вернувшийся файл остался зачёркнутым");
        await editor.capture("restored");

        // ── Deleting the src folder from the explorer ──
        // Focus the tree via the View menu (as in the rename-open-file scenario);
        // Home goes to the first row, the src folder (folders sort first).
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Explorer"));
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.sendKey("Home");
        await editor.sendKey("Delete");

        // clean.txt (no edits) closed; dirty.txt (unsaved edits) stays struck through.
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
