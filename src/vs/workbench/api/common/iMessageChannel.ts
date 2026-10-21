import type { IDisposable } from "../../../base/common/lifecycle.ts";

/**
 * Контракт: доставка асинхронная, не раньше следующего тика; после `dispose()`
 * `postMessage` молча игнорируется и листенеры не зовутся; данные — только
 * JSON-совместимые (стороны могут жить в разных процессах).
 */
export interface IMessageChannel extends IDisposable {
    postMessage(message: unknown): void;
    onMessage(listener: (message: unknown) => void): IDisposable;
}
