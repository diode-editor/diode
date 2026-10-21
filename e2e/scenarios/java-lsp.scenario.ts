import { resolve } from "node:path";

import type { CellSnapshot, GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Проект фикстуры без внешних зависимостей: classpath JDK для перехода хватает, а лишний артефакт добавил бы
// минуты; `~/.m2` не нужен — работает и с изолированным HOME.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "javaSample");
const appFile = resolve(sampleDir, "src", "main", "java", "demo", "App.java");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

/** `variable.parameter` в Dark Modern: параметром `who` делает только семантический токен jdt.ls, TextMate — нет. */
const PARAMETER_FG = 0x9cdcfe;

function findCell(frame: GridSnapshot, needle: string): CellSnapshot | undefined {
    for (let row = 0; row < frame.rows; row++) {
        const cells = frame.cells.slice(row * frame.cols, (row + 1) * frame.cols);
        const index = cells.map((cell) => cell.char || " ").join("").lastIndexOf(needle);
        if (index !== -1) return cells[index];
    }
    return undefined;
}

export default defineScenario({
    name: "java-lsp",
    title: "Java из коробки: jdt.ls — squiggle, семантическая подсветка, code actions, переход в JDK",
    // Папка первой: у redhat.java только `workspaceContains:`-события.
    open: [sampleDir, appFile],
    installVsix: ["redhat.java"],
    network: true,
    // Иначе тост согласия на телеметрию перекрывает правую часть редактора — ровно строки с волной.
    settings: { "redhat.telemetry.enabled": false },
    // Установка 139-МБ vsix, импорт maven-проекта и две JVM (syntax + standard server).
    timeoutMs: 900_000,
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("int broken = message;"));

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от jdt.ls", timeoutMs: 300_000, intervalMs: 1000 },
        );
        await editor.capture("diagnostics");

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => findCell(frame, "who;")?.fg === PARAMETER_FG,
            { describe: "семантический цвет параметра `who`", timeoutMs: 120_000, intervalMs: 1000 },
        );
        await editor.capture("semantic-tokens");

        // `int broken = message;` — строка 10. Меню — снимок code actions на момент открытия: волна приходит раньше,
        // чем jdt.ls готов отдать фиксы, и меню остаётся с одним «Source Actions…» — переоткрываем, пока фикс не появится.
        for (let i = 0; i < 9; i++) await editor.sendKey("ArrowDown");
        const fixTitle = "Change type of 'broken' to 'String'";
        const deadline = Date.now() + 180_000;
        for (;;) {
            await editor.sendKey("Ctrl+K");
            await editor.sendKey("Ctrl+Q");
            try {
                await editor.waitForText((t) => t.includes(fixTitle), { timeoutMs: 15_000 });
                break;
            } catch (err) {
                if (Date.now() > deadline) throw err;
                await editor.sendKey("Escape");
            }
        }
        await editor.capture("code-actions");

        // Цель F12 — `jdt://contents/java.base/java.lang/String.java`: до #363 такой uri ронял редактор.
        await editor.sendKey("Escape");
        await editor.sendKey("ArrowUp");
        for (let i = 0; i < 10; i++) await editor.sendKey("ArrowRight");
        // Пока jdt.ls не доиндексировал JRE, определение приходит пустым, и единственное F12 терялось (флак в половине
        // прогонов на 4 ядрах) — жмём, пока вкладка не откроется.
        const jumpDeadline = Date.now() + 180_000;
        for (;;) {
            await editor.sendKey("F12");
            try {
                await editor.waitForText((t) => t.includes("String.java"), { timeoutMs: 15_000 });
                break;
            } catch (err) {
                if (Date.now() > jumpDeadline) throw err;
            }
        }
        await editor.capture("jdk-source");
    },
});
