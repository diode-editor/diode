import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Protocol Buffers из магазина: НАСТОЯЩИЙ стоковый bufbuild.vscode-buf ставится
// ИЗ МАГАЗИНА (последняя опубликованная версия, установка по id) и сам
// скачивает бинарь buf с GitHub — ровно путь пользователя без buf в PATH.
// Демо закрывает видимую часть: squiggle на опечатке в типе, hover с
// doc-комментарием сообщения, F12 на объявление и автодополнение типа поля.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "protoSample");
const mainFile = resolve(sampleDir, "demo.proto");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) — сигнал «сервер поднялся». */
const UNDERCURL = 8;

function occurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

export default defineScenario({
    name: "buf-lsp",
    title: "Protocol Buffers из магазина: buf LSP — squiggle, hover, F12, автодополнение",
    open: [sampleDir, mainFile],
    installVsix: ["bufbuild.vscode-buf"],
    network: true,
    cols: 100,
    rows: 28,
    // Extension-host сценарии гоняют subprocess + нативный сервер — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Usr broken"));

        // Дождаться, пока расширение скачает buf и сервер проверит открытый файл.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от buf", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // Каретка на `User` в `rpc Get(User)` (строка 15, колонка 11) → hover
        // (Ctrl+K Ctrl+U): doc-комментарий в буфере один, второй — в попапе.
        for (let i = 0; i < 15; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 11; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+U");
        await editor.waitForText((t) => occurrences(t, "A user of the demo service.") >= 2, { timeoutMs: 60_000 });
        await editor.capture("hover");

        // F12 — переход к `message User` (строка 7 в статус-баре).
        await editor.sendKey("Escape");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes("Ln 7,"), { timeoutMs: 60_000 });
        await editor.capture("definition");

        // Пустая строка в теле `User` → набор `us` по клавише: попап с типом сообщения от
        // сервера (пункт попапа — `User` и рамка справа; слева от метки глиф codicon, не пробел).
        for (let i = 0; i < 5; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey("u");
        await editor.sendKey("s");
        await editor.waitForText((t) => /User\s+│/.test(t), { timeoutMs: 60_000 });
        await editor.capture("completion");
    },
});
