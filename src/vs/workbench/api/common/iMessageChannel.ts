import type { IDisposable } from "@tuidom/all/common/disposable";

/**
 * Симметричный канал двусторонней передачи сообщений между host'ом и
 * extension runtime. Сегодня реализован in-process (см. {@link createInProcessChannelPair}),
 * в Phase 8 будет реализация поверх pipe/IPC/`worker_threads.MessagePort`.
 *
 * Контракт:
 * - `postMessage` неблокирующий; доставка асинхронная (не раньше следующего тика).
 * - После `dispose()` любой `postMessage` молча игнорируется; ранее
 *   подписанные `onMessage`-листенеры больше не вызываются.
 * - Сообщения сериализуются «логически» (host и runtime могут жить в разных
 *   процессах) — передавайте только JSON-совместимые данные.
 */
export interface IMessageChannel extends IDisposable {
    postMessage(message: unknown): void;
    onMessage(listener: (message: unknown) => void): IDisposable;
}
