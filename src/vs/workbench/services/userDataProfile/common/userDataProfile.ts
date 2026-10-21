import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IUserDataProfile } from "../../../../platform/userDataProfile/common/userDataProfile.ts";

/** У эталона профиль переключается на лету; у нас он фиксирован на процесс, смена — перезагрузка окна. */
export interface IUserDataProfileService {
    readonly currentProfile: IUserDataProfile;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const IUserDataProfileServiceDIToken = token<IUserDataProfileService>("UserDataProfileService");

/** Категория команд профилей в палитре (`PROFILES_CATEGORY` эталона). */
export const PROFILES_TITLE = "Profiles";
export const PROFILES_CATEGORY = PROFILES_TITLE;
