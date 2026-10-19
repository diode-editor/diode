import { join } from "node:path";

import {
    ensureGopls,
    GO_ID,
    GO_SAMPLE_DIR,
    GO_SESSION_ENV,
    GO_TOOLS_BIN,
    goToolchainMissing,
} from "../../src/TestUtils/goFixture.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Go: НАСТОЯЩИЙ стоковый golang.go (из магазина по id, как у пользователя) и
// gopls из GOBIN фикстуры. Раньше `activate()` обрывался на
// отсутствующем `vscode.debug`: диагностики были, а ~60 команд `go.*` — нет.
// Демо закрывает видимую часть: squiggle на ошибке типов и лишнем импорте,
// версия Go в статус-баре, hover с doc-комментарием из другого пакета и F12 в
// него. Сценарий ничего не сохраняет — фикстура закоммичена, а format on save
// закрывает e2e goLsp.test.ts в изолированном воркспейсе.

const mainFile = join(GO_SAMPLE_DIR, "main.go");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) — сигнал «gopls поднялся». */
const UNDERCURL = 8;

export default defineScenario({
    name: "go-lsp",
    title: "Go (golang.go + gopls): squiggle, версия Go, hover, F12",
    open: [GO_SAMPLE_DIR, mainFile],
    installVsix: [GO_ID],
    network: true,
    requires: goToolchainMissing,
    // gopls — заранее в кэшируемый GOBIN: иначе расширение собирало бы его само.
    async prepare() {
        ensureGopls();
    },
    env: { ...GO_SESSION_ENV, GOBIN: GO_TOOLS_BIN },
    cols: 110,
    rows: 28,
    // Extension-host сценарии гоняют subprocess + сервер — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greet.Hello"));

        // Дождаться, пока настоящий gopls проверит открытый файл.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от gopls", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // Каретка на `Hello` в `greet.Hello("world")` (строка 10, символ 15) → hover.
        for (let i = 0; i < 10; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 15; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+U");
        await editor.waitForText((t) => t.includes("Hello returns a greeting"), { timeoutMs: 60_000 });
        await editor.capture("hover");

        // F12 — в объявление в greet/greet.go.
        await editor.sendKey("Escape");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes("strings.ToUpper(name)"), { timeoutMs: 60_000 });
        await editor.capture("definition");
    },
});
