import type { IDisposable } from "@tuidom/core/common/disposable";

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
    private readonly listeners: ((message: unknown) => void)[] = [];
    private readonly onIncoming: (message: unknown) => void;
    private readonly onDisconnect: () => void;
    private disposed = false;
    private alive = true;

    public constructor(endpoint: IIpcEndpoint) {
        this.endpoint = endpoint;
        this.onIncoming = (message: unknown): void => {
            if (this.disposed) return;
            for (const listener of this.listeners.slice()) {
                listener(message);
            }
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

    public onMessage(listener: (message: unknown) => void): IDisposable {
        if (this.disposed) {
            return { dispose: (): void => undefined };
        }
        this.listeners.push(listener);
        return {
            dispose: (): void => {
                const index = this.listeners.indexOf(listener);
                if (index >= 0) this.listeners.splice(index, 1);
            },
        };
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.alive = false;
        this.endpoint.off("message", this.onIncoming);
        this.endpoint.off("disconnect", this.onDisconnect);
        this.listeners.length = 0;
    }
}
