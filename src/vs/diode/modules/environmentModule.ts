import { type IEnvironmentService, IEnvironmentServiceDIToken } from "../../platform/environment/common/environment.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";

/**
 * Окружение процесса ({@link IEnvironmentService}): пути user data активного
 * профиля и флаги CLI. Собирается в `main.ts` до контейнера; тестовый профиль
 * подставляет окружение во временном каталоге.
 */
export const environmentModule: ContainerModule<IEnvironmentService> = (container, environment) => {
    container.bind(IEnvironmentServiceDIToken, () => environment);
};
