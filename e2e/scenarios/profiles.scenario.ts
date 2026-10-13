import { resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { frameToText } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Профили пользователя (итерация 1, docs/TODO/Profiles.md): реестр в
// `User/globalStorage/storage.json`, привязка профиля к ВОРКСПЕЙСУ (к файлу
// `.code-workspace`, если окно открыто им, иначе к папке), переключение —
// перезагрузкой окна. Сид user-data несёт каталог `User/profiles/work/` из
// времён, когда профиль был только флагом `--profile`: на первом старте он
// регистрируется как профиль `work` (миграция) и уже виден в пикере.
//
// Профиль `work` держит светлую тему — так смена профиля видна в кадре: у
// Light Modern фон редактора белый, у Dark Modern белых ячеек нет вовсе.
//
// Кадры: `default` (окно `web.code-workspace` в Default), `switch-picker`
// (пикер с галочкой у текущего), `work` (окно перезагрузилось в `work`),
// `backend-default` («Open Workspace from File...» → `backend.code-workspace`
// над той же папкой без привязки → окно перезагружается в Default),
// `new-profile-picker` (New Profile → `scratch` → Empty → окно в `scratch`),
// `deleted` (Delete Profile текущего → окно перезагружается в Default).

const fixture = resolve(repoRoot, "e2e", "fixtures", "workspaceFile");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-profiles");

const WHITE = 0xffffff;

/** Сколько ячеек кадра залито цветом `bg` — светлая тема против тёмной. */
function countBackground(frame: GridSnapshot, bg: number): number {
    return frame.cells.filter((cell) => cell.bg === bg).length;
}

async function expectTheme(editor: ScenarioDriver, light: boolean): Promise<void> {
    const frame = await editor.captureFrame();
    const white = countBackground(frame, WHITE);
    if (light && white < 100) throw new Error(`ожидалась светлая тема, белых ячеек: ${String(white)}`);
    if (!light && white > 0) throw new Error(`ожидалась тёмная тема, белых ячеек: ${String(white)}`);
}

/**
 * Ячейка пикера с подписью `label`: строки кадра режутся по рамке (`│`), так
 * что соседний текст эксплорера не мешает. Подпись — голая либо за одним
 * символом (глиф `$(check)` текущего профиля); строка статус-бара с именем
 * ветки репозитория сюда не попадёт.
 */
function pickerCell(text: string, label: string): string | undefined {
    return text
        .split("\n")
        .flatMap((line) => line.split("│"))
        .map((cell) => cell.trim())
        .find((cell) => cell === label || (cell.endsWith(` ${label}`) && cell.length <= label.length + 2));
}

/** Строка пикера с профилем `name` помечена глифом `$(check)` перед именем. */
function expectCurrentMark(frame: GridSnapshot, name: string): void {
    const cell = pickerCell(frameToText(frame), name);
    if (cell === undefined || cell === name) {
        throw new Error(`в пикере у строки \`${name}\` нет пометки текущего профиля: ${cell ?? "строки нет"}`);
    }
}

/** В кадре есть строка пикера с такой подписью (голой или за глифом текущего). */
function hasRow(text: string, label: string): boolean {
    return pickerCell(text, label) !== undefined;
}

/** Открыть команду палитры по полному заголовку. */
async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

/** Перезагрузка окна после команды профиля: старый сокет закрывается, новый поднимается на том же порту. */
async function reloaded(editor: ScenarioDriver): Promise<void> {
    await editor.reconnect();
    await editor.waitForText((t) => t.includes("EXPLORER"), { timeoutMs: 60_000 });
}

export default defineScenario({
    name: "profiles",
    title: "Профили: пикер, переключение с перезагрузкой, привязка к .code-workspace, New/Delete Profile",
    seedUserData: userData,
    open: [resolve(fixture, "web.code-workspace")],
    cols: 120,
    rows: 30,
    // Reload Window из сценария на Windows поднимает окно без сайдбара (docs/TODO/E2E.md).
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));
        await expectTheme(editor, false);
        await editor.capture("default");

        // Пикер: Default с галочкой, `work` — из мигрированного каталога.
        await runCommand(editor, "Profiles: Switch Profile...");
        await editor.waitForText((t) => t.includes("Select Profile") && t.includes("work") && t.includes("Default"));
        await editor.capture("switch-picker");
        await editor.sendText("work");
        await editor.waitForText((t) => t.includes("work") && !t.includes("Default"));
        // Enter → привязка `web.code-workspace` к `work` → перезагрузка окна.
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await expectTheme(editor, true);
        await editor.capture("work");

        // В новом окне галочка стоит у `work`.
        await runCommand(editor, "Profiles: Switch Profile...");
        await editor.waitForText((t) => t.includes("Select Profile"));
        expectCurrentMark(await editor.captureFrame(), "work");
        await editor.sendKey("Escape");

        // Другой файл воркспейса над той же папкой привязки не имеет → Default.
        await runCommand(editor, "File: Open Workspace from File...");
        await editor.waitForText((t) => t.includes("Enter a .code-workspace file path"));
        await editor.sendText(resolve(fixture, "backend.code-workspace"));
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await expectTheme(editor, false);
        await editor.capture("backend-default");

        // New Profile: имя → Empty → окно перезагружается уже в `scratch`.
        await runCommand(editor, "Profiles: New Profile...");
        await editor.waitForText((t) => t.includes("Profile name"));
        await editor.sendText("scratch");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Empty") && t.includes("Copy from current"));
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await runCommand(editor, "Profiles: Switch Profile...");
        await editor.waitForText((t) => t.includes("Select Profile") && hasRow(t, "scratch"));
        await editor.capture("new-profile-picker");
        await editor.sendKey("Escape");

        // Delete Profile текущего `scratch`: окно возвращается в Default.
        await runCommand(editor, "Profiles: Delete Profile...");
        await editor.waitForText((t) => t.includes("Select Profiles to Delete") && t.includes("Current"));
        await editor.sendText("scratch");
        // Статус-бар показывает ветку репозитория (фикстура лежит в нём), и в её
        // имени может быть что угодно — ждём именно чекбокс строки.
        await editor.waitForText((t) => t.includes("[ ] scratch"));
        await editor.sendKey(" ");
        await editor.waitForText((t) => t.includes("[✓] scratch"));
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await runCommand(editor, "Profiles: Switch Profile...");
        await editor.waitForText((t) => t.includes("Select Profile") && hasRow(t, "work") && !hasRow(t, "scratch"));
        await editor.capture("deleted");
        await editor.sendKey("Escape");
    },
});
