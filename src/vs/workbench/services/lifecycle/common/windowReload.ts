import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * Перезагрузка окна (`workbench.action.reloadWindow`) — шов между Workbench и
 * владельцем приложения. Само действие исполняет владелец (`main.ts`): он
 * отпускает терминал, extension host и состояние сессии, после чего заменяет
 * процесс новым с теми же аргументами (`base/node/restartProcess.ts`).
 *
 * Workbench про процессы ничего не знает — ему нужен только вызов, поэтому
 * шов живёт в `common/` и состоит из одного метода.
 */
export interface IWindowReloadHandler {
    /** Не возвращается: к моменту вызова окно уже прощается с пользователем. */
    reloadWindow(): void;
}

export const WindowReloadHandlerDIToken = token<IWindowReloadHandler>("WindowReloadHandler");
