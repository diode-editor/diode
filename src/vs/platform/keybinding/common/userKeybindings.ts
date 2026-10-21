import { token } from "../../instantiation/common/diContainer.ts";

/** Чистые данные: разбор `key` и регистрация — в Workbench, от которого этот слой зависеть не может. */
export interface IUserKeybindingRule {
    /** Пустая — только у снятия всех биндов команды. */
    readonly key: string;
    /** Ведущий "-" — снятие. */
    readonly command: string;
    readonly when?: string;
    readonly args?: unknown;
}

export const UserKeybindingsDIToken = token<readonly IUserKeybindingRule[]>("UserKeybindings");
