/**
 * Чтение журнала активации расширений с экрана — общее для сценариев-демо
 * `workspaceContains:` и `onCommand:`.
 *
 * Читаем канал Output «Extension Host»: хост пишет туда расширение и ПРИЧИНУ его
 * подъёма (`activated extension "<id>" (<событие>)`). Причина в строке и есть
 * ассерт таких сценариев: «расширение активно» без неё не отличить от активации
 * по какому-то другому событию.
 *
 * Две ловушки, из-за которых чтение оформлено помощником, а не тремя строками в
 * каждом сценарии:
 *
 * - **Тост стокового расширения висит поверх панели.** Настоящий ruff в
 *   `activate()` показывает сообщение про Python-окружение, и оно перекрывает
 *   правую половину Output — ровно там, где хвост нужной строки. Гасим его
 *   `notifications.clearAll`, причём НА КАЖДОЙ попытке: сообщение может приехать
 *   и после первой очистки.
 * - **Строка длиннее, чем editor Output с открытым сайдбаром.** Проводник
 *   съедает треть ширины, перенос в Output выключен — хвост строки просто не
 *   попадает в кадр. Прячем сайдбар.
 *
 * Клавиши, а не палитра: палитра возвращает фокус тому, кто её открыл, и её
 * маршрут здесь лишний шум. Буквы выбраны так, чтобы не совпасть с мнемониками
 * меню-бара (F/E/S/V/G/H — пойманный флак: `Alt+H` открывал меню Help) и с
 * префиксом SS3 (`ESC O` — это F1, поэтому не «O»).
 */

/** Кейбинды, которые сценарий обязан отдать в `userKeybindings`. */
export const ACTIVATION_LOG_KEYBINDINGS: readonly { key: string; command: string }[] = [
    { key: "alt+u", command: "workbench.action.output.toggleOutput" },
    { key: "alt+j", command: "workbench.action.output.show.extensions.host" },
    { key: "alt+y", command: "notifications.clearAll" },
    { key: "alt+b", command: "workbench.action.toggleSidebarVisibility" },
];

/** Минимальный контракт драйвера сценария, нужный помощнику. */
interface IActivationLogUi {
    sendKey(name: string): Promise<void>;
    waitForText(
        predicate: (text: string) => boolean,
        opts?: { timeoutMs?: number; intervalMs?: number },
    ): Promise<unknown>;
}

/** Прячет сайдбар и открывает канал «Extension Host» в нижней панели. */
export async function openActivationLog(ui: IActivationLogUi): Promise<void> {
    await ui.sendKey("Alt+B");
    await ui.sendKey("Alt+U");
    await ui.waitForText((t) => t.includes("OUTPUT"));
    await ui.sendKey("Alt+J");
    await ui.waitForText((t) => t.includes("Extension Host"));
}

/**
 * Ждёт строку журнала активации, гася тосты перед каждой попыткой. Короткое
 * пойманное ожидание в цикле, а не одно длинное: непойманное упало бы на тосте,
 * который приехал уже после очистки.
 */
export async function waitForActivationLine(ui: IActivationLogUi, needle: string, attempts = 30): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt++) {
        await ui.sendKey("Alt+Y");
        try {
            await ui.waitForText((t) => t.includes(needle), { timeoutMs: 4000 });
            // Ещё одна очистка перед кадром: тост мог вернуться между проверкой
            // и скриншотом, и демо показывало бы его вместо журнала.
            await ui.sendKey("Alt+Y");
            return;
        } catch {
            // Ещё не доехало (или тост успел вернуться) — повторяем.
        }
    }
    throw new Error(`activation log line not found: ${needle}`);
}
