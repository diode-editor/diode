import type { TuiApplication } from "@tuidom/core/dom/tuiApplication";

import type { ContainerModule, ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../platform/instantiation/common/diContainer.ts";
import { TuiApplicationDIToken } from "../../platform/layout/browser/tuiApplicationDIToken.ts";

export interface CoreModuleContext {
    app: TuiApplication;
}

/** `app` comes from outside: its lifetime starts before DI. In tests `TestApp` is created after the view — see `coreModuleLate`. */
export const coreModule: ContainerModule<CoreModuleContext> = (container, { app }) => {
    container.bind(ServiceAccessorDIToken, (): ServiceAccessor => container);
    container.bind(TuiApplicationDIToken, () => app);
};

export const coreModuleLate: ContainerModule = (container) => {
    container.bind(ServiceAccessorDIToken, (): ServiceAccessor => container);
};
