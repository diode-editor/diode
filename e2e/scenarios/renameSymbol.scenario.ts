import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Rename Symbol (F2) поверх НАСТОЯЩЕГО rename-провайдера стокового
// typescript-language-server: имя функции меняется и в открытой вкладке, и в
// ЗАКРЫТОМ файле-потребителе — правки провайдера едут через bulk workspace
// edit (#370), одним шагом отмены.
//
// Каталог сценарий наполняет в prepare: rename пишет на диск, а коммитнутую
// фикстуру пачкать нельзя (паттерн bulkWorkspaceEdit.scenario.ts).

const require_ = createRequire(import.meta.url);
const sampleDir = mkdtempSync(join(tmpdir(), "diode-rename-demo-"));
const defsFile = join(sampleDir, "defs.ts");
const closedFile = join(sampleDir, "main.ts");

/** `greet` объявлена в defs.ts, зовётся из закрытого main.ts — rename обязан задеть оба. */
const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply = greet("world");\n\nexport { reply };\n';

export default defineScenario({
    name: "rename-symbol",
    title: "Rename Symbol (F2): стоковый tsserver правит открытый И закрытый файл",
    // Открыт только объявляющий файл; потребитель остаётся закрытым.
    open: [sampleDir, defsFile],
    // Сервер живёт в devDeps репозитория (в SEA не пакуется — см. docs/TODO/LSP.md),
    // путь передаётся настройками; tsserver.js — для песочниц без своего TypeScript.
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Find All References уводит фокус в сайдбар — вернуть его редактору нечем,
    // кроме команды (своего бинда у неё нет, как и в VS Code). Буква не из
    // мнемоник меню-бара (F/E/S/V/G/H): Alt+<мнемоника> открыл бы меню.
    userKeybindings: [{ key: "alt+q", command: "workbench.action.focusActiveEditorGroup" }],
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(join(sampleDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }, null, 2));
        writeFileSync(defsFile, DEFS_TS);
        writeFileSync(closedFile, MAIN_TS);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("export function greet"));
        await editor.capture("before");

        // Каретка на имени в объявлении (строка 0, колонка 18).
        await editor.sendKey("Ctrl+Home");
        for (let i = 0; i < 18; i++) await editor.sendKey("ArrowRight");

        // Готовность сервера: на холодном старте tsserver отвечает по одному
        // открытому файлу, и переименование уехало бы мимо закрытого
        // потребителя. Признак готовности — ссылка из main.ts в панели
        // REFERENCES (Ctrl+K Ctrl+R); её же ждут references-сценарии.
        // Жмём до результата: пока проект не загружен, сервер отвечает пустым
        // списком, а на пустой ответ панель не открывается вовсе.
        await waitUntil(
            async () => {
                await editor.sendKey("Ctrl+K");
                await editor.sendKey("Ctrl+R");
                return editor.captureFrame();
            },
            (frame) => {
                const text = frame.cells
                    .map((cell) => cell.char)
                    .join("");
                return text.includes("REFERENCES") && text.includes("const reply = greet");
            },
            { describe: "ссылка из закрытого main.ts в панели REFERENCES", timeoutMs: 120_000, intervalMs: 2000 },
        );
        await editor.capture("references");

        // Фокус обратно в редактор — F2 гейтится `textInputFocus`.
        await editor.sendKey("Alt+q");
        await waitUntil(
            async () => {
                await editor.sendKey("F2");
                return editor.captureFrame();
            },
            (frame) =>
                frame.cells
                    .map((cell) => cell.char)
                    .join("")
                    .includes("Rename Symbol"),
            { describe: "оверлей Rename Symbol", timeoutMs: 60_000, intervalMs: 2000 },
        );
        // Поле предзаполнено текущим именем символа (prepareRename сервера).
        await editor.waitForText((t) => t.includes("greet"));
        await editor.capture("prompt");

        // Старое имя не выделено — поле несёт его текстом, поэтому стираем и
        // набираем новое (как в поле ввода VS Code с выделением).
        for (let i = 0; i < "greet".length; i++) await editor.sendKey("Backspace");
        await editor.sendText("welcome");
        await editor.sendKey("Enter");

        // Главная проверка: ЗАКРЫТЫЙ main.ts переименован на диске — и импорт,
        // и вызов.
        await waitUntil(
            () => Promise.resolve(readFileSync(closedFile, "utf8")),
            (text) => text.includes("import { welcome }") && text.includes('welcome("world")'),
            {
                describe: "импорт и вызов переименованы в закрытом main.ts",
                timeoutMs: 60_000,
                intervalMs: 250,
                diagnose: (last) => `main.ts сейчас:\n${String(last)}`,
            },
        );
        // …и открытая вкладка тоже.
        await editor.waitForText((t) => t.includes("export function welcome"), { timeoutMs: 30_000 });
        await editor.capture("after");

        // Весь rename — ОДИН шаг отмены (bulk edit): Ctrl+Z возвращает старое имя.
        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes("export function greet"), { timeoutMs: 30_000 });
        await editor.capture("undo");
    },
});
