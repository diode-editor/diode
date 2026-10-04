import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Rename Symbol (F2) поверх НАСТОЯЩЕГО rename-провайдера стокового
// typescript-language-server: имя функции меняется и в открытой вкладке, и в
// ЗАКРЫТОМ соседнем модуле — правки провайдера едут через bulk workspace edit
// (#370), одним шагом отмены.
//
// Каталог сценарий наполняет в prepare: rename пишет на диск, а коммитнутую
// фикстуру пачкать нельзя (паттерн bulkWorkspaceEdit.scenario.ts).

const require_ = createRequire(import.meta.url);
const sampleDir = mkdtempSync(join(tmpdir(), "diode-rename-demo-"));
const mainFile = join(sampleDir, "main.ts");
const closedFile = join(sampleDir, "defs.ts");

/** `greet` объявлена в defs.ts, зовётся из main.ts — rename обязан задеть оба. */
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply = greet("world");\n\nexport { reply };\n';
const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';

export default defineScenario({
    name: "rename-symbol",
    title: "Rename Symbol (F2): стоковый tsserver правит открытый И закрытый файл",
    open: [sampleDir, mainFile],
    // Сервер живёт в devDeps репозитория (в SEA не пакуется — см. docs/TODO/LSP.md),
    // путь передаётся настройками; tsserver.js — для песочниц без своего TypeScript.
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(join(sampleDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }, null, 2));
        writeFileSync(mainFile, MAIN_TS);
        writeFileSync(closedFile, DEFS_TS);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));
        await editor.capture("before");

        // Каретка на вызов `greet` (строка 2, колонка 16) → F2.
        await editor.sendKey("Ctrl+Home");
        for (let i = 0; i < 2; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 16; i++) await editor.sendKey("ArrowRight");

        // Readiness: tsserver индексирует проект секунды, и до готовности
        // rename-провайдер отвечает «переименовать нельзя» — поле ввода просто
        // не открывается. Поэтому F2 давим до появления оверлея.
        await waitUntil(
            async () => {
                await editor.sendKey("F2");
                return editor.captureFrame();
            },
            (frame) => frame.cells.map((cell) => cell.char).join("").includes("Rename Symbol"),
            { describe: "оверлей Rename Symbol от готового tsserver", timeoutMs: 120_000, intervalMs: 2000 },
        );
        // Поле предзаполнено текущим именем символа (prepareRename сервера).
        await editor.waitForText((t) => t.includes("greet"));
        await editor.capture("prompt");

        // Старое имя целиком выделено? Нет — поле несёт его текстом, поэтому
        // стираем и набираем новое (как в поле ввода VS Code с выделением).
        for (let i = 0; i < "greet".length; i++) await editor.sendKey("Backspace");
        await editor.sendText("welcome");
        await editor.sendKey("Enter");

        // Главная проверка: ЗАКРЫТЫЙ defs.ts переименован на диске.
        await waitUntil(
            () => Promise.resolve(readFileSync(closedFile, "utf8")),
            (text) => text.includes("export function welcome("),
            { describe: "объявление переименовано в закрытом defs.ts", timeoutMs: 60_000, intervalMs: 250 },
        );
        // …и открытая вкладка тоже: и вызов, и импорт.
        await editor.waitForText((t) => t.includes("welcome(\"world\")"), { timeoutMs: 30_000 });
        await editor.capture("after");

        // Весь rename — ОДИН шаг отмены (bulk edit): Ctrl+Z возвращает старое имя.
        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes('greet("world")'), { timeoutMs: 30_000 });
        await editor.capture("undo");
    },
});
