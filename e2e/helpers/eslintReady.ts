/**
 * Undercurl для .js — ЛОЖНЫЙ сигнал готовности eslint: builtin TS-клиент диагностирует и
 * javascript (флак: quickfix-меню из одних tsserver-рефакторингов). Уникальный признак eslint —
 * «Unnecessary semicolon.» (no-extra-semi из LINT_JS) в Problems. Панель — тоглом через палитру
 * (дефолтного бинда нет); закрытие возвращает фокус редактору.
 */

interface IEslintReadyUi {
    key(name: string): Promise<void>;
    text(value: string): Promise<void>;
    waitForText(
        predicate: (text: string) => boolean,
        opts?: { timeoutMs?: number; intervalMs?: number },
    ): Promise<unknown>;
}

/** Заголовок нижней панели — маркер «панель открыта» в кадре. */
const PANEL_TABS = "PROBLEMS  OUTPUT";

async function toggleProblems(ui: IEslintReadyUi): Promise<void> {
    await ui.key("Ctrl+P");
    await ui.text(">problems");
    await ui.waitForText((t) => t.includes("Toggle Problems"), { timeoutMs: 30_000 });
    await ui.key("Enter");
}

/** Ждёт диагностику настоящего eslintServer над LINT_JS-подобной фикстурой. */
export async function waitForEslintDiagnostics(ui: IEslintReadyUi, timeoutMs = 180_000): Promise<void> {
    await toggleProblems(ui);
    await ui.waitForText((t) => t.includes(PANEL_TABS), { timeoutMs: 30_000 });
    await ui.waitForText((t) => t.includes("Unnecessary semicolon."), { timeoutMs, intervalMs: 500 });
    await toggleProblems(ui);
    await ui.waitForText((t) => !t.includes(PANEL_TABS), { timeoutMs: 30_000 });
}
