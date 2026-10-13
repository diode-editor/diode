import { token } from "../../instantiation/common/diContainer.ts";

/**
 * Куда уходит заголовок окна. В терминале «окно» — это окно эмулятора, и его
 * заголовок ставится OSC-последовательностью (`ESC ] 0 ; <title> BEL`), как
 * делают shell'ы и tmux. Порт нужен, потому что `writeOscSequence` есть у
 * конкретных бэкендов (`NodeTerminalBackend`, `HeadlessCaptureBackend`), а не
 * у `ITerminalBackend`; владелец бэкенда (`main.ts`) связывает его здесь, как
 * `OscClipboard`. В тестах — запись в массив.
 */
export type ITerminalTitleSink = (title: string) => void;

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TerminalTitleSinkDIToken = token<ITerminalTitleSink>("TerminalTitleSink");

/** OSC 0 — заголовок и иконка окна терминала разом; BEL — терминатор, понятный всем. */
export function terminalTitleSequence(title: string): string {
    // Управляющие символы в заголовке оборвали бы последовательность.
    // eslint-disable-next-line no-control-regex -- режем именно управляющие
    return `\x1b]0;${title.replace(/[\x00-\x1f\x7f]/g, " ")}\x07`;
}
