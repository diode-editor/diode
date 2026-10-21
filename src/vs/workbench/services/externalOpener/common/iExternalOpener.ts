import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * `true` means the link reached the user: the system handler opened it, or (ssh, container)
 * the URL was shown and copied to the clipboard. `false` means neither; the extension may complain.
 */
export interface IExternalOpener {
    open(url: string): Promise<boolean>;
}

export const ExternalOpenerDIToken = token<IExternalOpener>("ExternalOpener");
