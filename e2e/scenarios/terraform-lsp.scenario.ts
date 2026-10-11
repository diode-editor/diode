import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Terraform из магазина: НАСТОЯЩИЙ стоковый hashicorp.terraform ставится ИЗ
// МАГАЗИНА (последняя опубликованная версия, установка по id) и поднимает
// вшитый terraform-ls. Раньше расширение падало на активации (TreeItem,
// context.extension, createTelemetryLogger, authentication) — подсветка была,
// а языкового сервера не было. Демо закрывает видимую часть: squiggle на
// лишнем атрибуте, hover над `var.region`, F12 на объявление переменной и
// автодополнение атрибутов aws_instance из вшитой схемы AWS.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "tfSample");
const mainFile = resolve(sampleDir, "main.tf");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) — сигнал «сервер поднялся». */
const UNDERCURL = 8;

function occurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

export default defineScenario({
    name: "terraform-lsp",
    title: "Terraform из магазина: terraform-ls — squiggle, hover, F12, автодополнение",
    open: [sampleDir, mainFile],
    installVsix: ["hashicorp.terraform"],
    network: true,
    cols: 100,
    rows: 28,
    // Extension-host сценарии гоняют subprocess + нативный сервер — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("bogus_attr"));

        // Дождаться, пока настоящий terraform-ls проверит открытый файл.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от terraform-ls", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // Каретка на `var.region` (строка 14, колонка 17) → hover (Ctrl+K Ctrl+U):
        // в буфере `var.region` один раз, второе вхождение — заголовок попапа.
        for (let i = 0; i < 14; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 17; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+U");
        await editor.waitForText((t) => occurrences(t, "var.region") >= 2, { timeoutMs: 60_000 });
        await editor.capture("hover");

        // F12 — переход к `variable "region"` (строка 9 в статус-баре).
        await editor.sendKey("Escape");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes("Ln 9,"), { timeoutMs: 60_000 });
        await editor.capture("definition");

        // Пустая строка в теле aws_instance → Ctrl+Space: атрибуты из вшитой
        // схемы AWS (без terraform CLI и без `terraform init`).
        for (let i = 0; i < 11; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey("Ctrl+Space");
        await editor.waitForText((t) => t.includes("ami") && t.includes("optional, string"), { timeoutMs: 60_000 });
        await editor.capture("completion");
    },
});
