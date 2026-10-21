/**
 * Причина в строке `activated extension "<id>" (<событие>)` канала «Extension Host» и есть ассерт
 * сценариев `workspaceContains:`/`onCommand:`. Две ловушки:
 * - тост стокового ruff про Python-окружение перекрывает хвост строки — гасим
 *   `notifications.clearAll` на КАЖДОЙ попытке: он может приехать и после первой очистки;
 * - с открытым сайдбаром хвост длинной строки не влезает (перенос в Output выключен) — прячем.
 *
 * Клавиши, а не палитра: палитра возвращает фокус открывшему. Буквы не совпадают с мнемониками
 * меню-бара (F/E/S/V/G/H — флак: `Alt+H` открывал Help) и с SS3 (`ESC O` — это F1, поэтому не «O»).
 */

/** Кейбинды, которые сценарий обязан отдать в `userKeybindings`. */
export const ACTIVATION_LOG_KEYBINDINGS: readonly { key: string; command: string }[] = [
    { key: "alt+u", command: "workbench.action.output.toggleOutput" },
    { key: "alt+j", command: "workbench.action.output.show.extensions.host" },
    { key: "alt+y", command: "notifications.clearAll" },
    { key: "alt+b", command: "workbench.action.toggleSidebarVisibility" },
];

interface IActivationLogUi {
    sendKey(name: string): Promise<void>;
    waitForText(
        predicate: (text: string) => boolean,
        opts?: { timeoutMs?: number; intervalMs?: number },
    ): Promise<unknown>;
}

export async function openActivationLog(ui: IActivationLogUi): Promise<void> {
    await ui.sendKey("Alt+B");
    await ui.sendKey("Alt+U");
    await waitPastToasts(ui, (t) => t.includes("OUTPUT"), "вкладка OUTPUT");
    await ui.sendKey("Alt+J");
    // Подпись канала — в ПРАВОЙ части шапки, ровно под тостом (флак CI: строка журнала была в
    // кадре, а «Extension Host» закрывал тост ruff'а).
    await waitPastToasts(ui, (t) => t.includes("Extension Host"), "канал Extension Host");
}

export async function waitForActivationLine(ui: IActivationLogUi, needle: string): Promise<void> {
    await waitPastToasts(ui, (t) => t.includes(needle), `строка журнала «${needle}»`);
    // Ещё одна очистка перед кадром: тост мог вернуться между проверкой и
    // скриншотом, и демо показывало бы его вместо журнала.
    await ui.sendKey("Alt+Y");
}

/**
 * Цикл коротких пойманных попыток, а не один длинный `waitForText`: тост приезжает асинхронно, и до
 * очистки, и после, — непойманное ожидание упало бы на первом же таком кадре.
 */
async function waitPastToasts(
    ui: IActivationLogUi,
    predicate: (text: string) => boolean,
    what: string,
    attempts = 30,
): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt++) {
        await ui.sendKey("Alt+Y");
        try {
            await ui.waitForText(predicate, { timeoutMs: 4000 });
            return;
        } catch {
            // Ещё не доехало (или тост успел вернуться) — повторяем.
        }
    }
    throw new Error(`activation log: не дождались — ${what}`);
}
