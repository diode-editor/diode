import { resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// Сообщения с кнопками (`window.show{Information,Warning,Error}Message`) и оба
// члена `env`, которые на них стоят.
//
// Раньше это была дыра: `showMessage` уезжал fire-and-forget, `items`
// отбрасывались, а на экране не появлялось ничего — расширение, которое
// спрашивает разрешение кнопками (стоковые AI-автокомплиты умеют только так),
// молча не работало. Сценарий проходит весь круг: тост при активации → фокус в
// стек аккордом → нажатие кнопки → ответ вернулся В КОД расширения (оно печатает
// его в полосу статуса) → стек из трёх сообщений → `env.openExternal` без
// системного открывателя показывает ссылку, а «Copy Link» кладёт её в буфер
// обмена, из которого расширение её и читает.

// Markdown, а не .ts, и без папки-воркспейса: иначе полосу статуса делят с нами
// спиннер запуска tsserver и сегменты SCM, и табло ответов расширения выезжает за
// правый край кадра (та же грабля, что у сценария status-bar-extension).
const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-notification-demo");

/** Открывает палитру и исполняет команду демо по её заголовку. */
async function runDemoCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

/** Аккорд `notifications.focusToasts` — две клавиши, как его набирает человек. */
async function focusToasts(editor: ScenarioDriver): Promise<void> {
    await editor.sendKey("Ctrl+K");
    await editor.sendKey("Ctrl+N");
}

export default defineScenario({
    name: "notifications",
    title: "Сообщения расширения с кнопками, внешние ссылки и буфер обмена",
    seedUserData: userData,
    open: [sampleFile],
    cols: 100,
    rows: 30,
    // Автоскрытие выключено: тост не должен исчезать посреди сценария.
    settings: { "notifications.autoHideTimeout": 0 },
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (как
    // inline-completion — субпроцесс расширений на Windows флейкает).
    skipOn: ["win32"],
    async run(editor) {
        // ─── Вопрос при активации ───────────────────────────────────────────
        // Расширение спрашивает сразу после activate() — как это делают стоковые.
        await editor.waitForText((t) => t.includes("Use free version"), { timeoutMs: 30000 });
        await editor.capture("toast-with-buttons");

        // ─── Фокус в стек и ответ ───────────────────────────────────────────
        // Подсказка в тосте называет аккорд — им и идём к кнопкам.
        await editor.waitForText((t) => t.includes("Ctrl+K Ctrl+N to answer"));
        await focusToasts(editor);
        await editor.capture("toast-focused");

        // Стрелка переводит на вторую кнопку, Enter отвечает.
        await editor.sendKey("ArrowRight");
        await editor.sendKey("Enter");
        // Ответ вернулся В КОД расширения: оно печатает его в полосу статуса.
        await editor.waitForText((t) => t.includes("picked Use free version"), { timeoutMs: 10000 });
        await editor.capture("answer-back-in-extension");

        // ─── Стек сообщений ─────────────────────────────────────────────────
        await runDemoCommand(editor, "Notification Demo: Warn");
        await editor.waitForText((t) => t.includes("unsaved changes"), { timeoutMs: 10000 });
        await runDemoCommand(editor, "Notification Demo: Error");
        await editor.waitForText((t) => t.includes("Language server crashed"), { timeoutMs: 10000 });
        await runDemoCommand(editor, "Notification Demo: Ask");
        await editor.waitForText(
            (t) => t.includes("unsaved changes") && t.includes("Language server crashed") && t.includes("Activate"),
            { timeoutMs: 10000 },
        );
        await editor.capture("stack-of-three");

        // Escape по сфокусированному стеку закрывает все сообщения.
        await focusToasts(editor);
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("Language server crashed"), { timeoutMs: 10000 });
        await editor.capture("stack-cleared");

        // ─── env.openExternal без системного открывателя ────────────────────
        // Браузера здесь нет (headless), поэтому ссылка приезжает человеку тостом.
        await runDemoCommand(editor, "Notification Demo: Open Link");
        await editor.waitForText((t) => t.includes("example.com/activate") && t.includes("Copy Link"), {
            timeoutMs: 10000,
        });
        await editor.capture("link-for-the-human");

        // «Copy Link» кладёт адрес в буфер обмена приложения…
        await focusToasts(editor);
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("openExternal true"), { timeoutMs: 10000 });

        // …и расширение читает его оттуда же, откуда вставляет человек.
        await runDemoCommand(editor, "Notification Demo: Read Clipboard");
        await editor.waitForText((t) => t.includes("clip example.com"), { timeoutMs: 10000 });
        await editor.capture("clipboard-round-trip");
    },
});
