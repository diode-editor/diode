import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type { IMessageChannel } from "./iMessageChannel.ts";

/**
 * Минимальный интерфейс endpoint'а node IPC. Совместим как с `process` внутри
 * subprocess, так и с `ChildProcess` на parent-стороне.
 *
 * Все используемые методы — это пересечение API `NodeJS.Process` и
 * `ChildProcess` для IPC-канала.
 */
export interface IIpcEndpoint {
    send(message: unknown): boolean;
    on(event: "message", listener: (msg: unknown) => void): unknown;
    on(event: "disconnect", listener: () => void): unknown;
    off(event: "message", listener: (msg: unknown) => void): unknown;
    off(event: "disconnect", listener: () => void): unknown;
}

/**
 * `IMessageChannel` поверх Node IPC-канала (`child_process.fork` /
 * `child_process.spawn(..., { stdio: [..., 'ipc'] })`).
 *
 * - `postMessage` -> `endpoint.send` (silent no-op после dispose/disconnect).
 * - Сериализация выполняется самим Node IPC (structured clone-ish JSON).
 * - При `disconnect`-событии endpoint считается мёртвым: новые `postMessage`
 *   игнорируются, существующие подписки получают это как естественный конец
 *   потока сообщений. Endpoint НЕ убивается (это ответственность владельца).
 */
export class IpcMessageChannel implements IMessageChannel {
    private readonly endpoint: IIpcEndpoint;
    private readonly onMessageEmitter = new Emitter<unknown>();
    private readonly onIncoming: (message: unknown) => void;
    private readonly onDisconnect: () => void;
    private disposed = false;
    private alive = true;

    public constructor(endpoint: IIpcEndpoint) {
        this.endpoint = endpoint;
        this.onIncoming = (message: unknown): void => {
            if (this.disposed) return;
            this.onMessageEmitter.fire(message);
        };
        this.onDisconnect = (): void => {
            this.alive = false;
        };
        endpoint.on("message", this.onIncoming);
        endpoint.on("disconnect", this.onDisconnect);
    }

    public postMessage(message: unknown): void {
        if (this.disposed || !this.alive) return;
        try {
            this.endpoint.send(message);
        } catch {
            // Канал мог закрыться между проверкой и отправкой — молча.
            this.alive = false;
        }
    }

    public readonly onMessage = this.onMessageEmitter.event;

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.alive = false;
        this.endpoint.off("message", this.onIncoming);
        this.endpoint.off("disconnect", this.onDisconnect);
        // Доставку после dispose и так отсекает гард `disposed`; снятие слушателей
        // ненаблюдаемо снаружи и держится ради освобождения их замыканий.
        // Stryker disable next-line CallExpression: эквивалентен — см. выше
        this.onMessageEmitter.dispose();
    }
}
