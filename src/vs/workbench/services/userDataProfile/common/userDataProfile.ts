import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IUserDataProfile } from "../../../../platform/userDataProfile/common/userDataProfile.ts";

/**
 * Активный профиль окна (аналог `IUserDataProfileService` эталона,
 * `workbench/services/userDataProfile/common/userDataProfile.ts`). У эталона
 * профиль переключается на лету (`onDidChangeCurrentProfile`); у нас он
 * фиксирован на процесс, смена — перезагрузка окна (`IHostProcess.restart` с
 * `IRelaunchRequest`), поэтому здесь только текущее значение.
 */
export interface IUserDataProfileService {
    readonly currentProfile: IUserDataProfile;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const IUserDataProfileServiceDIToken = token<IUserDataProfileService>("UserDataProfileService");

/** Категория команд профилей в палитре (`PROFILES_CATEGORY` эталона). */
export const PROFILES_TITLE = "Profiles";
export const PROFILES_CATEGORY = PROFILES_TITLE;
