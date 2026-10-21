import { token } from "../../instantiation/common/diContainer.ts";

/** Plain data: parsing `key` and registration live in Workbench, which this layer can't depend on. */
export interface IUserKeybindingRule {
    /** Empty only for a removal of all of a command's bindings. */
    readonly key: string;
    /** A leading "-" means removal. */
    readonly command: string;
    readonly when?: string;
    readonly args?: unknown;
}

export const UserKeybindingsDIToken = token<readonly IUserKeybindingRule[]>("UserKeybindings");
