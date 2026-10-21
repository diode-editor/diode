import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import type { ITerminalTitleSink } from "../../platform/terminal/common/terminalTitleSink.ts";
import { TerminalTitleSinkDIToken } from "../../platform/terminal/common/terminalTitleSink.ts";
import type {
    IUserDataProfile,
    IUserDataProfilesService,
} from "../../platform/userDataProfile/common/userDataProfile.ts";
import { IUserDataProfilesServiceDIToken } from "../../platform/userDataProfile/common/userDataProfile.ts";
import { IUserDataProfileServiceDIToken } from "../../workbench/services/userDataProfile/common/userDataProfile.ts";

export interface UserDataProfileModuleContext {
    readonly profilesService: IUserDataProfilesService;
    /** Фиксирован на процесс. */
    readonly currentProfile: IUserDataProfile;
    readonly terminalTitle?: ITerminalTitleSink;
}

export const userDataProfileModule: ContainerModule<UserDataProfileModuleContext> = (container, ctx) => {
    container.bind(IUserDataProfilesServiceDIToken, () => ctx.profilesService);
    container.bind(IUserDataProfileServiceDIToken, () => ({ currentProfile: ctx.currentProfile }));
    const terminalTitle = ctx.terminalTitle ?? (() => undefined);
    container.bind(TerminalTitleSinkDIToken, () => terminalTitle);
};
