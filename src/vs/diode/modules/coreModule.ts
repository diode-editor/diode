import type { TuiApplication } from "@tuidom/core/dom/tuiApplication";

import type { ContainerModule, ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../platform/instantiation/common/diContainer.ts";
import { TuiApplicationDIToken } from "../../platform/layout/browser/tuiApplicationDIToken.ts";

export interface CoreModuleContext {
    app: TuiApplication;
}

/** `app` приходит снаружи: его жизнь начинается до DI. В тестах `TestApp` создаётся после view — см. `coreModuleLate`. */
export const coreModule: ContainerModule<CoreModuleContext> = (container, { app }) => {
    container.bind(ServiceAccessorDIToken, (): ServiceAccessor => container);
    container.bind(TuiApplicationDIToken, () => app);
};

export const coreModuleLate: ContainerModule = (container) => {
    container.bind(ServiceAccessorDIToken, (): ServiceAccessor => container);
};
