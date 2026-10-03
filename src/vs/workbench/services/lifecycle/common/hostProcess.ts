import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * Процесс-владелец приложения — шов между Workbench и `main.ts`: чем
 * заканчивается прощание (`LifecycleService.shutdown`). Выход
 * (`workbench.action.quit`) завершает процесс, перезагрузка окна
 * (`workbench.action.reloadWindow`) заменяет его новым с теми же аргументами
 * (`base/node/restartProcess.ts`).
 *
 * Workbench про процессы ничего не знает — ему нужны только два вызова,
 * поэтому шов живёт в `common/`. Ресурсы (терминал, субпроцессы, состояние
 * сессии) к моменту вызова уже отпущены участниками прощания.
 */
export interface IHostProcess {
    /** Завершить процесс. */
    exit(): void;
    /** Заменить процесс новым с теми же аргументами. */
    restart(): void;
}

export const HostProcessDIToken = token<IHostProcess>("HostProcess");
