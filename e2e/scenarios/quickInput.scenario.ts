import { resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// Ввод по просьбе расширения (`window.showInputBox` / `window.showQuickPick`):
// фикстурное расширение `quick-input-probe` из палитры просит строку и выбор, а
// поднимается при этом ТОТ ЖЕ оверлей, которым пользуются палитра и Quick Open.
//
// Сценарий проходит четыре состояния, ради которых заявка и делалась: поле ввода
// с подсказкой и валидацией (ошибка блокирует Enter, предупреждение — нет), поле
// пароля под маской, список с фильтрацией и множественный выбор с чекбоксами. Ответ расширения печатается
// строкой в канал Output «Diode Probe» — по ней видно, что введённое реально
// доехало до расширения, а не осталось в UI.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-quick-input-probe");

/** Открывает палитру и исполняет команду пробника по её заголовку. */
async function runProbeCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "quick-input",
    title: "Расширение просит строку и выбор (showInputBox / showQuickPick)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (как
    // inline-completion — субпроцесс расширений на Windows флейкает).
    skipOn: ["win32"],
    async run(editor) {
        // Пробник поднимает канал Output при активации: по нему и читаются ответы.
        await editor.waitForText((t) => t.includes("Diode Probe"), { timeoutMs: 30000 });

        // ─── Поле ввода с валидацией ────────────────────────────────────────
        await runProbeCommand(editor, "Ask Port");
        await editor.waitForText((t) => t.includes("Порт сервера"), { timeoutMs: 20000 });
        await editor.capture("input-box");

        // Ошибка валидации: сообщение под полем и заблокированный Enter.
        await editor.sendText("ab");
        await editor.waitForText((t) => t.includes("Только цифры"));
        await editor.capture("error-message");
        await editor.sendKey("Enter");
        // Оверлей на месте — Enter съеден жёсткой ошибкой.
        await editor.waitForText((t) => t.includes("Только цифры"));

        // Предупреждение Enter не блокирует.
        await editor.sendKey("Backspace");
        await editor.sendKey("Backspace");
        await editor.sendText("80");
        await editor.waitForText((t) => t.includes("Порт < 1024"));
        await editor.capture("warning-message");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Port: 80"), { timeoutMs: 20000 });
        await editor.capture("input-accepted");

        // ─── Поле пароля ────────────────────────────────────────────────────
        // Набранное закрыто маской: на кадре только звёздочки, самого секрета
        // не видно, а расширение получает НАСТОЯЩИЙ текст — по его длине это и
        // проверяется.
        await runProbeCommand(editor, "Ask Secret");
        await editor.waitForText((t) => t.includes("Набранное закрыто маской"), { timeoutMs: 20000 });
        await editor.sendText("hunter2");
        await editor.waitForText((t) => t.includes("*******") && !t.includes("hunter2"));
        await editor.capture("password-masked");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Secret length: 7"), { timeoutMs: 20000 });

        // ─── Список с фильтрацией ───────────────────────────────────────────
        await runProbeCommand(editor, "Pick Fruit");
        await editor.waitForText((t) => t.includes("Выберите фрукт") && t.includes("cherry"), { timeoutMs: 20000 });
        await editor.capture("quick-pick");

        await editor.sendText("ch");
        await editor.waitForText((t) => t.includes("cherry") && !t.includes("banana"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Fruit: cherry"), { timeoutMs: 20000 });

        // ─── Множественный выбор с чекбоксами ───────────────────────────────
        await runProbeCommand(editor, "Pick Many (preselected)");
        await editor.waitForText((t) => t.includes("[✓] beta"), { timeoutMs: 20000 });
        await editor.capture("multi-select");

        // Space отмечает строку под курсором: оверлей остаётся открытым.
        await editor.sendKey(" ");
        await editor.waitForText((t) => t.includes("[✓] alpha"));
        await editor.capture("multi-select-checked");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Picked: alpha, beta"), { timeoutMs: 20000 });
        await editor.capture("multi-select-accepted");

        // ─── Свой потребитель оверлея не сломался ───────────────────────────
        // Палитра после множественного выбора: чекбоксов в ней нет.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("File: Save"));
        await editor.capture("palette-intact");
        await editor.sendKey("Escape");
    },
});
