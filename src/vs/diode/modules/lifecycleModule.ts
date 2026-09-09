import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { WindowReloadHandlerDIToken } from "../../workbench/services/lifecycle/common/windowReload.ts";

export interface LifecycleModuleContext {
    /**
     * Перезагрузка окна: отпустить терминал, extension host и состояние сессии,
     * после чего заменить процесс новым с теми же аргументами. Всё это знает
     * только владелец приложения (`main.ts`), поэтому сюда приезжает замыканием.
     */
    reloadWindow: () => void;
}

/**
 * Жизненный цикл приложения со стороны владельца процесса. Пока это один шов —
 * перезагрузка окна (`workbench.action.reloadWindow`); выход живёт отдельно
 * (`QuitHandlerDIToken` → `WorkbenchComponent`), потому что там владельцу
 * достаточно teardown'а и `process.exit`.
 */
export const lifecycleModule: ContainerModule<LifecycleModuleContext> = (container, { reloadWindow }) => {
    container.bind(WindowReloadHandlerDIToken, () => ({ reloadWindow }));
};
