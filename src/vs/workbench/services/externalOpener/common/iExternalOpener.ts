import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * Открыватель внешних ссылок (`env.openExternal` расширений, аналог
 * `IOpenerService` VS Code).
 *
 * Контракт в `common`, потому что потребители живут в разных окружениях:
 * зовёт его host-мост расширений (`node`), а реализация запускает системный
 * обработчик (`xdg-open`/`open`/`cmd start`) и потому тоже `node`.
 *
 * `open` возвращает `true`, когда ссылка ДОЕХАЛА до человека: её либо открыл
 * системный обработчик, либо — там, где графического окружения нет (ssh,
 * контейнер, голый сервер) — реализация показала URL и положила его в буфер
 * обмена. `false` значит «ни то, ни другое не получилось», и расширение вправе
 * ругаться своим способом.
 */
export interface IExternalOpener {
    open(url: string): Promise<boolean>;
}

export const ExternalOpenerDIToken = token<IExternalOpener>("ExternalOpener");
