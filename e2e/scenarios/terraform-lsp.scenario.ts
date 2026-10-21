import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Регрессия: расширение падало на активации (TreeItem, context.extension, createTelemetryLogger, authentication).

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "tfSample");
const mainFile = resolve(sampleDir, "main.tf");

/** StyleFlags.Undercurl. */
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

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от terraform-ls", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // `var.region` (строка 14, колонка 17): в буфере он один, второе вхождение — заголовок hover-попапа.
        for (let i = 0; i < 14; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 17; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+U");
        await editor.waitForText((t) => occurrences(t, "var.region") >= 2, { timeoutMs: 60_000 });
        await editor.capture("hover");

        await editor.sendKey("Escape");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes("Ln 9,"), { timeoutMs: 60_000 });
        await editor.capture("definition");

        // Атрибуты — из вшитой схемы AWS, без terraform CLI и `terraform init`.
        for (let i = 0; i < 11; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey("Ctrl+Space");
        await editor.waitForText((t) => t.includes("ami") && t.includes("optional, string"), { timeoutMs: 60_000 });
        await editor.capture("completion");
    },
});
