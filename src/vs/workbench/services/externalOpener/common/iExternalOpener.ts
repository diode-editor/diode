import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * `true` — ссылка доехала до человека: её открыл системный обработчик или (ssh, контейнер)
 * URL показан и положен в буфер. `false` — ни то, ни другое, расширение вправе ругаться.
 */
export interface IExternalOpener {
    open(url: string): Promise<boolean>;
}

export const ExternalOpenerDIToken = token<IExternalOpener>("ExternalOpener");
