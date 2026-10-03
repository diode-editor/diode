import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import type { IHostProcess } from "../../workbench/services/lifecycle/common/hostProcess.ts";
import { HostProcessDIToken } from "../../workbench/services/lifecycle/common/hostProcess.ts";

export interface LifecycleModuleContext {
    /**
     * Чем заканчивается прощание: выход или замена процесса новым. Оба знает
     * только владелец процесса (`main.ts`), поэтому сюда приезжают хуками.
     */
    hostProcess: IHostProcess;
}

/**
 * Жизненный цикл приложения со стороны владельца процесса — шов
 * `HostProcessDIToken`. Сам протокол прощания (`LifecycleService`) — в
 * `workbenchModule`; ресурсы отпускают его участники, а сюда остаётся только
 * последний шаг: `exit` или `restart`.
 */
export const lifecycleModule: ContainerModule<LifecycleModuleContext> = (container, { hostProcess }) => {
    container.bind(HostProcessDIToken, () => hostProcess);
};
