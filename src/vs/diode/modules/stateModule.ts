import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../platform/state/common/nullStateService.ts";

export interface StateModuleContext {
    stateService: IStateService;
}

export const stateModule: ContainerModule<StateModuleContext> = (container, { stateService }) => {
    container.bind(StateServiceDIToken, () => stateService);
};

export const stateModuleDefault: ContainerModule = (container) => {
    container.bind(StateServiceDIToken, () => NULL_STATE_SERVICE);
};
