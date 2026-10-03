import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type { IMessageChannel } from "./iMessageChannel.ts";

/**
 * Создаёт пару связанных in-process каналов. Сообщения, отправленные в один
 * конец, доставляются в другой через `queueMicrotask` (асинхронно, чтобы
 * семантика совпадала с будущим транспортом поверх IPC/MessagePort).
 *
 * Если канал был disposed — `postMessage` no-op, новые `onMessage`-листенеры
 * никогда не вызываются.
 */
export function createInProcessChannelPair(): [IMessageChannel, IMessageChannel] {
    const a = new InProcessChannel();
    const b = new InProcessChannel();
    a.connect(b);
    b.connect(a);
    return [a, b];
}

class InProcessChannel implements IMessageChannel {
    private peer: InProcessChannel | null = null;
    private readonly onMessageEmitter = new Emitter<unknown>();
    private disposed = false;

    public connect(peer: InProcessChannel): void {
        this.peer = peer;
    }

    public postMessage(message: unknown): void {
        if (this.disposed) return;
        const peer = this.peer;
        /* v8 ignore start -- defensive: createInProcessChannelPair always connects both ends and InProcessChannel is not exported, so peer is never null here */
        if (peer === null) return;
        /* v8 ignore stop */
        // Cериализация-десериализация имитирует структурное копирование, как
        // в реальном IPC: ловит расширения, мутирующие отправленные объекты.
        const serialized = JSON.stringify(message);
        queueMicrotask(() => {
            if (peer.disposed) return;
            const decoded: unknown = JSON.parse(serialized);
            peer.onMessageEmitter.fire(decoded);
        });
    }

    public readonly onMessage = this.onMessageEmitter.event;

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        // Доставку после dispose и так отсекает гард `disposed`; снятие слушателей
        // ненаблюдаемо снаружи и держится ради освобождения их замыканий.
        // Stryker disable next-line CallExpression: эквивалентен — см. выше
        this.onMessageEmitter.dispose();
    }
}
