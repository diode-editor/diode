import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Два окна API расширений на одном кадре: активная тема
// (`window.activeColorTheme` + `onDidChangeActiveColorTheme`) и выделение
// (`window.onDidChangeTextEditorSelection`). Фикстурное расширение
// `theme-selection-demo` держит оба в статус-баре, поэтому кадры показывают
// ровно то, что видит расширение: тема верна уже на активации, стрелка даёт
// Keyboard, клик мышью — Mouse, а смена темы через Ctrl+K Ctrl+T перекрашивает
// не только редактор, но и ответ API.

// Файл неизвестного языка и без папки-воркспейса: не будить tsserver, чей
// спиннер двигает сегменты полосы (та же причина, что в statusBarExtension).
const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.hello");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-theme-selection");

export default defineScenario({
    name: "theme-selection-api",
    title: "window.activeColorTheme и onDidChangeTextEditorSelection",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (как
    // statusBarExtension — субпроцесс расширений на Windows флейкает).
    skipOn: ["win32"],
    async run(editor) {
        // Тема доехала до расширения ДО activate(): пункт уже несёт Dark,
        // а не заглушку и не «?».
        await editor.waitForText((t) => t.includes("Theme Dark"), { timeoutMs: 20_000 });
        await editor.capture("activated");

        // Стрелка вниз — команда с кейбинда, но для расширения это Keyboard
        // (как в VS Code, где стрелка тоже приезжает не Command'ом).
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("Sel 2:2 Keyboard"), { timeoutMs: 5000 });
        await editor.capture("keyboard");

        // Клик мышью в тексте — тот же слушатель, другой вид жеста. Координата
        // считается от левого края ЭКРАНА: окно без папки тоже держит сайдбар
        // (Explorer с подсказкой), поэтому текст начинается около 36-й колонки,
        // а клик правее конца строки 4 клампится в её конец — `Sel 4:12`.
        //
        // Предел тот же, что у клавиатурного шага (5с): событие сюда не «едет
        // дольше», оно либо есть, либо нет. Раньше здесь стояло 20с под гипотезу
        // «холодный раннер медленный» — она была неверна, и падало всё равно.
        // Настоящая причина была в движке: клик — это пара press/release, ответ
        // субпроцесса приходил между ними, а хит-тест release гасил layout-грязь
        // ленивым layout'ом, и запланированный кадр не рисовался вовсе (экран —
        // ретейн-буфер, поэтому старая строка оставалась навсегда). Починено в
        // tuidom гейтом кадра по `needsRepaint` (tuidom#22); замер после правки —
        // 51–75мс на 65 прогонах подряд.
        await editor.click(50, 5);
        await editor.waitForText((t) => t.includes("Sel 4:12 Mouse"), { timeoutMs: 5000 });
        await editor.capture("mouse");

        // Смена темы: пикер → Light+ → пункт расширения переезжает на Light
        // вместе с палитрой редактора.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+T");
        await editor.waitForText((t) => t.includes("Light+"));
        await editor.sendText("Light+");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Theme Light"), { timeoutMs: 5000 });
        await editor.capture("light-theme");
    },
});
