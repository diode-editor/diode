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
    /** Реестр профилей и привязок — собран в `main.ts` до резолва активного профиля. */
    readonly profilesService: IUserDataProfilesService;
    /** Активный профиль окна: фиксирован на процесс. */
    readonly currentProfile: IUserDataProfile;
    /** Заголовок окна терминала; без него заголовок не ставится (тесты). */
    readonly terminalTitle?: ITerminalTitleSink;
}

/**
 * Профили: реестр (`IUserDataProfilesService`, platform) и активный профиль
 * окна (`IUserDataProfileService`, workbench). Оба — готовые значения: реестр
 * читается раньше контейнера (от него зависит каталог активного профиля), а
 * профиль фиксирован на процесс. Здесь же — сток заголовка окна, который фича
 * профилей наполняет именем профиля.
 */
export const userDataProfileModule: ContainerModule<UserDataProfileModuleContext> = (container, ctx) => {
    container.bind(IUserDataProfilesServiceDIToken, () => ctx.profilesService);
    container.bind(IUserDataProfileServiceDIToken, () => ({ currentProfile: ctx.currentProfile }));
    const terminalTitle = ctx.terminalTitle ?? (() => undefined);
    container.bind(TerminalTitleSinkDIToken, () => terminalTitle);
};
