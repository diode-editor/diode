import { resolve } from "node:path";

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

export default defineScenario({
    name: "java-lsp",
    title: "Java из коробки: jdt.ls — squiggle, code actions, переход в JDK",
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

        // Каретка на `int broken = message;` (строка 10) → меню code actions
        // (Ctrl+K Ctrl+Q — досягаемый везде чорд): фиксы настоящего jdt.ls.
        for (let i = 0; i < 9; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText((t) => t.includes("Change type of 'broken' to 'String'"), { timeoutMs: 120_000 });
        await editor.capture("code-actions");

        // Escape закрывает меню → каретка на `String` строкой выше → F12.
        // Цель — не файл на диске, а `jdt://contents/java.base/java.lang/String.java`:
        // до #363 такой uri ронял редактор целиком.
        await editor.sendKey("Escape");
        await editor.sendKey("ArrowUp");
        for (let i = 0; i < 10; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes("String.java"), { timeoutMs: 120_000 });
        await editor.capture("jdk-source");
    },
});
