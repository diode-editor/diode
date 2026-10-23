import type { TuiApplication } from "@tuidom/core/dom/tuiApplication";

import { AdjustableClock, AdjustableClockDIToken, ClockDIToken } from "../../platform/clock/common/clock.ts";
import type { Container, ContainerModule, ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../platform/instantiation/common/diContainer.ts";
import { TuiApplicationDIToken } from "../../platform/layout/browser/tuiApplicationDIToken.ts";

export interface CoreModuleContext {
    app: TuiApplication;
}

/** `app` comes from outside: its lifetime starts before DI. In tests `TestApp` is created after the view — see `coreModuleLate`. */
export const coreModule: ContainerModule<CoreModuleContext> = (container, { app }) => {
    container.bind(ServiceAccessorDIToken, (): ServiceAccessor => container);
    container.bind(TuiApplicationDIToken, () => app);
    // Stryker disable next-line CallExpression: the production container only (unit tests build theirs with coreModuleLate); without it the window fails to start, which every e2e catches
    bindClock(container);
};

export const coreModuleLate: ContainerModule = (container) => {
    container.bind(ServiceAccessorDIToken, (): ServiceAccessor => container);
    bindClock(container);
};

function bindClock(container: Container): void {
    container.bind(AdjustableClockDIToken, () => new AdjustableClock());
    container.bind(ClockDIToken, () => container.get(AdjustableClockDIToken));
}
