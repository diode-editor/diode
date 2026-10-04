import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../api/common/extHostProtocol.ts";

/** Контекст одного спавна субпроцесса ext host'а. Живёт ровно до его смерти или выключения. */
export interface IExtensionHostContext {
    /** RPC текущего спавна; методы из карты протокола проверяются компилятором. */
    readonly rpc: HostRpc;
    readonly logger: ILogger | undefined;
}

/**
 * Поверхность API расширений на стороне хоста (upstream — `mainThread*` из
 * `services/extensions/common/extHostCustomers.ts`). Объект живёт столько же,
 * сколько `ExtensionHost`; на каждый спавн хост зовёт {@link attach} до
 * первого сообщения ребёнка. ВСЁ состояние спавна — обработчики, подписки на
 * ядро, handle'ы — заводится внутри `attach` и снимается возвращённым
 * disposable: на смерти субпроцесса и на выключении одинаково. Сброс
 * «вручную» отдельным списком не нужен.
 */
export interface IExtensionHostCustomer {
    attach(ctx: IExtensionHostContext): IDisposable;
}
