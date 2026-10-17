import { token } from "../../instantiation/common/diContainer.ts";

/**
 * Куда уходит заголовок окна. В терминале «окно» — это окно эмулятора, и его
 * заголовок ставится OSC-последовательностью (`ESC ] 0 ; <title> BEL`), как
 * делают shell'ы и tmux. Порт нужен, потому что `setWindowTitle` есть у
 * конкретных бэкендов (`NodeTerminalBackend`, `HeadlessCaptureBackend`), а не
 * у `ITerminalBackend`; владелец бэкенда (`main.ts`) связывает его здесь, как
 * `OscClipboard`. Последовательность и push/pop прежнего заголовка — забота
 * бэкенда. В тестах — запись в массив.
 */
export type ITerminalTitleSink = (title: string) => void;

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TerminalTitleSinkDIToken = token<ITerminalTitleSink>("TerminalTitleSink");
