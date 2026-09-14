/**
 * Честный readiness-сигнал eslint-сьютов. Undercurl в кадре для .js-файла —
 * сигнал ЛОЖНЫЙ: builtin TS-клиент работает и для javascript, его диагностики
 * рисуются тем же undercurl'ом, и шаги eslint стартовали бы до готовности
 * его сервера (пойманный флак: quickfix-меню из одних tsserver-рефакторингов).
 * Уникальный признак eslint — текст его диагностики в панели Problems:
 * «Unnecessary semicolon.» (no-extra-semi из канонического LINT_JS) не выдаёт
 * ни один другой поставщик.
 *
 * Панель открывается/закрывается тоглом через палитру (дефолтного бинда у
 * `workbench.actions.view.problems` нет); закрытие возвращает фокус редактору —
 * проверено квикфиксом следом.
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
