import { resolve } from "node:path";

import type { CellSnapshot, GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Java из коробки: НАСТОЯЩИЙ redhat.java ставится ИЗ МАГАЗИНА (платформенный
// vsix со вшитым JRE — своего JDK машине не нужно), Eclipse JDT LS поднимается
// сам. Демо закрывает видимую часть: squiggle от сервера, меню code actions с
// фиксами jdt.ls и переход F12 в исходники JDK — вкладка `String.java`, которой
// на диске нет: содержимое отдаёт расширение через
// registerTextDocumentContentProvider на схеме `jdt:`.
//
// Проект фикстуры БЕЗ внешних зависимостей: classpath JDK для перехода хватает,
// а лишний артефакт добавил бы к прогону минуты. Проверено, что `~/.m2` при этом
// не нужен вовсе — всё работает и с изолированным HOME, которым e2e гоняет.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "javaSample");
const appFile = resolve(sampleDir, "src", "main", "java", "demo", "App.java");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) — сигнал «сервер поднялся». */
const UNDERCURL = 8;

/**
 * Цвет параметра в Dark Modern (`variable.parameter` → #9CDCFE). Использование
 * `who` в `return "hello, " + who;` TextMate-грамматика Java не размечает (цвет
 * текста #CCCCCC) — параметром его делает только семантический токен jdt.ls.
 */
const PARAMETER_FG = 0x9cdcfe;

/** Ячейка первой буквы последнего вхождения `needle` в строке кадра, где оно есть. */
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
    // Папка ПЕРВОЙ: у redhat.java есть только `workspaceContains:`-события,
    // без папки воркспейса расширение не активируется вовсе.
    open: [sampleDir, appFile],
    installVsix: ["redhat.java"],
    network: true,
    // Без этого расширение спрашивает согласие на сбор телеметрии, и ТОСТ
    // ПЕРЕКРЫВАЕТ правую часть редактора — ровно те строки, где рисуется волна.
    // Ассерт по кадру её тогда не видит, хотя статус-бар честно показывает
    // «Java: Ready»: сервер жив, просто squiggle закрыт. Заодно тесты не шлют
    // телеметрию наружу.
    settings: { "redhat.telemetry.enabled": false },
    // 300с мало: внутрь кейса попадают установка 139-МБ платформенного vsix,
    // импорт maven-проекта и старт двух JVM (syntax + standard server).
    timeoutMs: 900_000,
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн JVM — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("int broken = message;"));

        // Дождаться, пока jdt.ls импортирует maven-проект и отлинтит его: до
        // готовности сервера диагностик нет вовсе.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от jdt.ls", timeoutMs: 300_000, intervalMs: 1000 },
        );
        await editor.capture("diagnostics");

        // Семантическая подсветка jdt.ls поверх TextMate: `who` в теле метода
        // перекрашивается в цвет параметра, когда приходят semantic tokens.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => findCell(frame, "who;")?.fg === PARAMETER_FG,
            { describe: "семантический цвет параметра `who`", timeoutMs: 120_000, intervalMs: 1000 },
        );
        await editor.capture("semantic-tokens");

        // Каретка на `int broken = message;` (строка 10) → меню code actions
        // (Ctrl+K Ctrl+Q — досягаемый везде чорд): фиксы настоящего jdt.ls.
        //
        // Меню — снимок code actions на момент открытия. Волна приходит раньше,
        // чем jdt.ls готов отдавать по ней фиксы (импорт проекта ещё идёт), и
        // открытое в это окно меню так и остаётся с одним «Source Actions…» —
        // в CI это съедало все 120 с ожидания. Поэтому переоткрываем меню, пока
        // фикс не появится.
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

        // Escape закрывает меню → каретка на `String` строкой выше → F12.
        // Цель — не файл на диске, а `jdt://contents/java.base/java.lang/String.java`:
        // до #363 такой uri ронял редактор целиком.
        await editor.sendKey("Escape");
        await editor.sendKey("ArrowUp");
        for (let i = 0; i < 10; i++) await editor.sendKey("ArrowRight");
        // Тот же класс гонки, что у меню выше: пока jdt.ls не доиндексировал JRE,
        // определение `String` приходит пустым, и единственное F12 терялось
        // навсегда — 120 с ожидания и красный сценарий примерно в половине
        // прогонов на 4 ядрах (тот же бинарь то проходил за 35 с, то нет).
        // Поэтому жмём F12, пока вкладка не откроется.
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
