import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IUserDataProfile } from "../../../../platform/userDataProfile/common/userDataProfile.ts";

/** Upstream switches profiles on the fly; here the profile is fixed per process, switching reloads the window. */
export interface IUserDataProfileService {
    readonly currentProfile: IUserDataProfile;
}

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference, so the string is only a debug label
export const IUserDataProfileServiceDIToken = token<IUserDataProfileService>("UserDataProfileService");

/** Command palette category for profile commands (upstream `PROFILES_CATEGORY`). */
export const PROFILES_TITLE = "Profiles";
export const PROFILES_CATEGORY = PROFILES_TITLE;
