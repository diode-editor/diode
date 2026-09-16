import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Комментирование по language configuration стокового пака typescript-basics:
// Ctrl+/ тогглит строку/выделение построчным токеном `//`, block comment
// оборачивает выделение парой `/* */`. Токены НЕ захардкожены — приезжают из
// extensions/typescript-basics/language-configuration.json через
// LanguageConfigurationService.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "comment-line",
    title: "Toggle Line Comment (Ctrl+/) и Block Comment по language-configuration",
    open: [repoRoot, sampleFile],
    // Shift+Alt+A legacy-терминал не передаёт (как и Shift+Alt+F в format-сценарии) —
    // вешаем ту же команду на досягаемый F6.
    userKeybindings: [{ key: "f6", command: "editor.action.blockComment" }],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Каретка на строку с объявлением → Ctrl+/ комментирует её токеном языка.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+/");
        await editor.waitForText((t) => t.includes('// const greeting = "hello";'));
        await editor.capture("toggle-line");

        // Повторный Ctrl+/ снимает маркер (toggle, а не дописывание).
        await editor.sendKey("Ctrl+/");
        await editor.waitForText((t) => t.includes('const greeting = "hello";') && !t.includes("// const greeting"));

        // Выделение трёх строк (функция целиком) → один Ctrl+/ комментирует все.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Shift+ArrowDown");
        await editor.sendKey("Shift+ArrowDown");
        await editor.sendKey("Shift+End");
        await editor.sendKey("Ctrl+/");
        await editor.waitForText(
            (t) => t.includes("// export function greet") && t.includes("// }"),
        );
        await editor.capture("toggle-selection");
        await editor.sendKey("Ctrl+/");
        await editor.waitForText((t) => !t.includes("// export function"));

        // Block comment (Shift+Alt+A, здесь F6) оборачивает выделение парой.
        await editor.sendKey("Home");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("Shift+End");
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("/* const answer = 42; */"));
        await editor.capture("block-comment");
    },
});
