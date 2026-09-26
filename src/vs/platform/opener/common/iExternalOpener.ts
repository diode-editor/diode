import { token } from "../../instantiation/common/diContainer.ts";

/**
 * Открыватель внешних ссылок (аналог `IExternalOpener` VS Code): отдать `http:`,
 * `mailto:` и прочие не-редакторные адреса тому, кто их умеет открыть.
 *
 * Возвращает `true`, когда ссылка дошла до получателя. «Получатель» —
 * намеренно шире, чем «запустился браузер»: у реализации-композита
 * ({@link import("../../../workbench/services/opener/browser/openerService.ts").OpenerService})
 * второй путь — показать ссылку человеку так, чтобы он мог её забрать. Там, где
 * системного открывателя нет (ssh, голый сервер), это ЕДИНСТВЕННЫЙ возможный
 * успех, и `false` в этом случае врал бы вызывающему: ссылка у пользователя.
 * `false` остаётся за настоящим отказом — ни открыть, ни показать.
 */
export interface IExternalOpener {
    /** `target` — адрес строкой (`uri.toString()`), а не голый путь. */
    openExternal(target: string): Promise<boolean>;
}

export const ExternalOpenerDIToken = token<IExternalOpener>("ExternalOpener");
