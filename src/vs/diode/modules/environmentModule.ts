import { type IEnvironmentService, IEnvironmentServiceDIToken } from "../../platform/environment/common/environment.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";

export const environmentModule: ContainerModule<IEnvironmentService> = (container, environment) => {
    container.bind(IEnvironmentServiceDIToken, () => environment);
};
