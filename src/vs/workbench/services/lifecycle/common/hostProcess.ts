import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * Чем следующее окно отличается от этого при перезагрузке. Без запроса окно
 * поднимается с тем же профилем и теми же аргументами. Профиль — именем
 * (`--profile <name>` следующего окна), воркспейс — путём папки или файла
 * `.code-workspace` (он замещает позиционные аргументы этого окна).
 */
export interface IRelaunchRequest {
    readonly profile?: string | undefined;
    readonly workspace?: string | undefined;
}

/**
 * Процесс-владелец приложения — шов между Workbench и `main.ts`: чем
 * заканчивается прощание (`LifecycleService.shutdown`). Выход
 * (`workbench.action.quit`) завершает процесс, перезагрузка окна
 * (`workbench.action.reloadWindow`) заменяет его новым с теми же аргументами
 * (`base/node/restartProcess.ts`) — либо с другим профилем/воркспейсом
 * ({@link IRelaunchRequest}: переключение профиля, Open Folder в чужом профиле).
 *
 * Workbench про процессы ничего не знает — ему нужны только два вызова,
 * поэтому шов живёт в `common/`. Ресурсы (терминал, субпроцессы, состояние
 * сессии) к моменту вызова уже отпущены участниками прощания.
 */
export interface IHostProcess {
    /** Завершить процесс. */
    exit(): void;
    /** Заменить процесс новым: с теми же аргументами либо по {@link IRelaunchRequest}. */
    restart(relaunch?: IRelaunchRequest): void;
}

export const HostProcessDIToken = token<IHostProcess>("HostProcess");
