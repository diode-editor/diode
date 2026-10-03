import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Bulk workspace edit (M1): code action стокового typescript-language-server
// правит ВТОРОЙ файл, которого нет ни в одной вкладке. Раньше такой edit
// отвечал честным `false`, и пользователь видел «Code action failed» на любом
// действии, трогающем соседний файл («Add import from …», «Declare method …»,
// «Move to a new file»).
//
// Каталог сценарий наполняет в prepare: правка закрытого файла ложится НА ДИСК,
// а коммитнутую фикстуру пачкать нельзя (паттерн eslint-lint.scenario.ts).

const require_ = createRequire(import.meta.url);
const sampleDir = mkdtempSync(join(tmpdir(), "diode-bulkedit-demo-"));
const mainFile = join(sampleDir, "a.ts");
const closedFile = join(sampleDir, "b.ts");

/** Вызов отсутствующего метода класса из СОСЕДНЕГО модуля — фикс правит b.ts. */
const A_TS = 'import { B } from "./b";\n\nconst b = new B();\nb.greet();\n';
const B_TS = "export class B {}\n";

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

export default defineScenario({
    name: "bulk-workspace-edit",
    title: "Bulk workspace edit: code action правит ЗАКРЫТЫЙ файл (Declare method)",
    open: [sampleDir, mainFile],
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
        writeFileSync(mainFile, A_TS);
        writeFileSync(closedFile, B_TS);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("const b = new B()"));

        // Readiness: undercurl от НАСТОЯЩЕГО tsserver (`greet` нет у класса B).
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );
        // Открыт только a.ts: b.ts правится не через вкладку, а по диску.
        await editor.capture("before");

        // Каретка на `b.greet()` (открытие ставит её в (0,0)) → меню действий.
        await editor.sendKey("Ctrl+Home");
        for (let i = 0; i < 3; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 3; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText((t) => t.includes("Select Code Action"), { timeoutMs: 60_000 });
        // Пин на нужное действие набором в фильтр — порядок пунктов за сервером.
        await editor.sendText("Declare method");
        await editor.waitForText((t) => t.includes("Declare method"));
        await editor.capture("menu");

        await editor.sendKey("Enter");
        // Главная проверка: ЗАКРЫТЫЙ b.ts изменился на диске.
        await waitUntil(
            () => Promise.resolve(readFileSync(closedFile, "utf8")),
            (text) => text.includes("greet"),
            { describe: "метод greet дописан в закрытый b.ts", timeoutMs: 60_000, intervalMs: 250 },
        );

        // Видимая часть: открываем b.ts и показываем новый метод в кадре.
        await editor.sendKey("Ctrl+P");
        await editor.sendText("b.ts");
        await editor.waitForText((t) => t.includes("b.ts"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("greet"), { timeoutMs: 30_000 });
        await editor.capture("after");
    },
});
