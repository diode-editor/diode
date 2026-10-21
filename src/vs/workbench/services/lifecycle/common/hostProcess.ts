import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** Без запроса окно поднимается с тем же профилем и аргументами; воркспейс замещает позиционные аргументы. */
export interface IRelaunchRequest {
    readonly profile?: string | undefined;
    readonly workspace?: string | undefined;
}

/** Чем заканчивается прощание; ресурсы к моменту вызова уже отпущены его участниками. */
export interface IHostProcess {
    exit(): void;
    restart(relaunch?: IRelaunchRequest): void;
}

export const HostProcessDIToken = token<IHostProcess>("HostProcess");
