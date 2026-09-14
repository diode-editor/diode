import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureEslintLibrary, ESLINT_FLAT_CONFIG, linkEslintLibrary } from "../../src/TestUtils/eslintFixture.ts";
import { waitForEslintDiagnostics } from "../helpers/eslintReady.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// JS-линт из коробки: НАСТОЯЩИЙ стоковый vscode-eslint ставится ИЗ МАГАЗИНА.
// Библиотеку eslint расширение не бандлит — она приезжает в воркспейс демо
// через prepare (npm-кэш фикстуры + симлинк node_modules), поэтому каталог
// не коммитится. Демо закрывает видимую часть: squiggle на проблемах, quickfix
// с фиксом правила и флагманский fix-on-save (`source.fixAll.eslint`) — текста
// без `;;` в исходном файле нет.

// Каталог сценарий наполняет в prepare: он же СОХРАНЯЕТ файл, коммитнутую
// фикстуру пачкать нельзя (паттерн onSaveFixes.scenario.ts).
const sampleDir = mkdtempSync(join(tmpdir(), "diode-eslint-demo-"));
const lintFile = join(sampleDir, "app.js");

/** Пара «уходит после фикса» / «остаётся»: no-extra-semi чинится, no-unused-vars — нет. */
const APP_JS = 'const unused = 1;;\n\nfunction greet(name) {\n    return "hi " + name;;\n}\n\nconsole.log(greet("world"));\n';

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) — сигнал «сервер поднялся». */
const UNDERCURL = 8;

export default defineScenario({
    name: "eslint-lint",
    title: "JS-линт из коробки: eslint — squiggle, quickfix, fix on save",
    open: [sampleDir, lintFile],
    installVsix: ["dbaeumer.vscode-eslint"],
    settings: {
        "editor.codeActionsOnSave": { "source.fixAll": true },
    },
    network: true,
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(join(sampleDir, "eslint.config.mjs"), ESLINT_FLAT_CONFIG);
        writeFileSync(lintFile, APP_JS);
        linkEslintLibrary(sampleDir, ensureEslintLibrary());
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("const unused"));

        // Дождаться диагностик настоящего eslintServer. Не по undercurl'у:
        // builtin TS-клиент линтит .js тоже, его подчёркивания приходят раньше
        // и делают сигнал ложным (см. e2e/helpers/eslintReady.ts).
        await waitForEslintDiagnostics({
            key: (name) => editor.sendKey(name),
            text: (value) => editor.sendText(value),
            waitForText: (predicate, opts) => editor.waitForText(predicate, opts),
        });
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от eslint", timeoutMs: 30_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // Каретка на первой строке (`const unused = 1;;`) → quickfix-меню
        // (Ctrl+K Ctrl+Q — досягаемый везде чорд): фиксы настоящего eslint.
        // Меню наполняется ОДНИМ запросом с 5с-таймаутом: попади он в занятый
        // сервер — меню останется пустым навсегда, сколько ни жди (пойманный
        // флак). Поэтому не ждём одного открытия 60с, а переоткрываем меню.
        for (let attempt = 0; ; attempt++) {
            await editor.sendKey("Ctrl+K");
            await editor.sendKey("Ctrl+Q");
            try {
                await editor.waitForText((t) => t.includes("no-extra-semi"), { timeoutMs: 20_000 });
                break;
            } catch (err) {
                if (attempt >= 2) throw err;
                await editor.sendKey("Escape");
            }
        }
        await editor.capture("quickfix");

        // Escape закрывает меню → Ctrl+S: codeActionsOnSave прогоняет
        // source.fixAll.eslint — обе лишние `;` уходят ДО записи на диск,
        // неиспользуемая переменная (не автофикс) остаётся под squiggle.
        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+S");
        await editor.waitForText((t) => !t.includes(";;"), { timeoutMs: 60_000 });
        await editor.capture("fixed-on-save");
    },
});
