import { resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// Видимые сообщения расширений (`window.show{Information,Warning,Error}Message`)
// и связанный с ними `env`.
//
// Сценарий проходит состояния, ради которых заявка и делалась. Главное из них —
// сообщение С КНОПКАМИ: у AI-автодополнений (Supermaven и родня) это
// ЕДИНСТВЕННАЯ дверь к регистрации, команды в палитре для этого выбора у них
// нет. Поэтому здесь не только «тост нарисовался», но и полный путь ответа:
// F6 ведёт фокус на кнопки, Enter выбирает, а выбранное доезжает обратно в
// расширение — это видно строкой в канале Output «Diode Notify».
//
// Второй мотив — невидимые ошибки: `showErrorMessage` расширения раньше уходил
// только в лог, и человек видел молчащее расширение без объяснения.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-notifications-probe");

/** Открывает палитру и исполняет команду пробника по её заголовку. */
async function runProbeCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "notifications",
    title: "Сообщения расширений с кнопками (show*Message) и env.openExternal",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (как
    // quick-input — субпроцесс расширений на Windows флейкает).
    skipOn: ["win32"],
    async run(editor) {
        // Пробник поднимает канал Output при активации: по нему читаются ответы.
        await editor.waitForText((t) => t.includes("Diode Notify"), { timeoutMs: 30000 });

        // ─── Сообщение без кнопок ───────────────────────────────────────────
        // Раньше этого не было видно нигде: текст уходил только в лог. У тоста
        // есть кнопка закрытия — сообщение обязано быть чем убрать (как
        // `notification.clear` в эталоне).
        await runProbeCommand(editor, "Show Error");
        await editor.waitForText((t) => t.includes("tsserver: crashed 3 times") && t.includes("×"), {
            timeoutMs: 20000,
        });
        await editor.capture("error-toast");

        // ─── Вопрос с кнопками ──────────────────────────────────────────────
        // Случай Supermaven дословно. Фокус тост НЕ забирает — в рамке написано,
        // чем до кнопок добраться.
        await runProbeCommand(editor, "Ask Activate");
        await editor.waitForText((t) => t.includes("Use free version") && t.includes("F6"), { timeoutMs: 20000 });
        await editor.capture("question");

        // F6 ведёт фокус на кнопки: подсказка меняется на управление.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Enter — выбрать"));
        await editor.capture("question-focused");

        // Ответ доезжает до расширения — это и есть закрываемый контракт.
        await editor.sendKey("ArrowRight");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Ask returned: Use free version"), { timeoutMs: 20000 });
        await editor.capture("answer-delivered");

        // ─── Стек сообщений ─────────────────────────────────────────────────
        // Видно три, остальные ЖДУТ МЕСТА (строка «+N more»), а не теряются.
        await runProbeCommand(editor, "Show Many");
        await editor.waitForText((t) => t.includes("Message one") && t.includes("more"), { timeoutMs: 20000 });
        await editor.capture("stack");

        await runProbeCommand(editor, "Clear All");
        await editor.waitForText((t) => !t.includes("Message one"), { timeoutMs: 20000 });

        // ─── Модальное сообщение ────────────────────────────────────────────
        // `MessageOptions.modal` — окно по центру с приглушённым detail; Escape
        // отдаёт кнопку, помеченную isCloseAffordance.
        await runProbeCommand(editor, "Ask Modal");
        await editor.waitForText((t) => t.includes("Delete 12 files permanently?"), { timeoutMs: 20000 });
        await editor.capture("modal");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => t.includes("Modal returned: item:Cancel"), { timeoutMs: 20000 });

        // ─── env.openExternal без графического окружения ────────────────────
        // Запускать браузер в контейнере/по ssh нечем, поэтому ссылка ОТДАЁТСЯ
        // человеку: URL уезжает в буфер обмена и показывается сообщением.
        await runProbeCommand(editor, "Open External");
        await editor.waitForText((t) => t.includes("Ссылка скопирована в буфер обмена"), { timeoutMs: 20000 });
        await editor.capture("open-external-fallback");
        // Тост стоит над статус-баром и накрывает нижние ряды панели Output —
        // убираем его, иначе свежей строки расширения на кадре не видно.
        await runProbeCommand(editor, "Clear All");
        await editor.waitForText((t) => t.includes("openExternal returned: true"), { timeoutMs: 20000 });

        // ─── env.clipboard ──────────────────────────────────────────────────
        // Запись и чтение идут в тот же буфер, которым пользуются copy/paste ядра.
        await runProbeCommand(editor, "Clipboard Round Trip");
        // Ждём по началу строки: полный текст в панели Output обрезан её шириной.
        await editor.waitForText((t) => t.includes("clipboard readText: clipboard-from"), { timeoutMs: 20000 });
        await editor.capture("clipboard");
    },
});
