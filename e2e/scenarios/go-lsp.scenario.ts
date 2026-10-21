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

// Ничего не сохраняем — фикстура закоммичена; format on save закрывает goLsp.test.ts в изолированном воркспейсе.

const mainFile = join(GO_SAMPLE_DIR, "main.go");

/** StyleFlags.Undercurl — сигнал «gopls поднялся». */
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
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greet.Hello"));

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от gopls", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // `Hello` в `greet.Hello("world")`: строка 10, символ 15.
        for (let i = 0; i < 10; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 15; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+U");
        await editor.waitForText((t) => t.includes("Hello returns a greeting"), { timeoutMs: 60_000 });
        await editor.capture("hover");

        await editor.sendKey("Escape");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes("strings.ToUpper(name)"), { timeoutMs: 60_000 });
        await editor.capture("definition");
    },
});
