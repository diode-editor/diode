import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import type { IHostProcess } from "../../workbench/services/lifecycle/common/hostProcess.ts";
import { HostProcessDIToken } from "../../workbench/services/lifecycle/common/hostProcess.ts";

export interface LifecycleModuleContext {
    hostProcess: IHostProcess;
}

export const lifecycleModule: ContainerModule<LifecycleModuleContext> = (container, { hostProcess }) => {
    container.bind(HostProcessDIToken, () => hostProcess);
};
