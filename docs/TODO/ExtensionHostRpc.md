# RPC extension host'а: ошибки, отмена, таймауты, карта методов (G4)

Статус: `[x]` сделано (#513, #515, #518, #519, #520, #522 и закрывающий PR карты).

Транспорт `RpcEndpoint` (request/response/notification, `$/cancelRequest`)
устроен нормально, плохо то, что над ним: ошибка через провод теряет `name`,
`stack` и `code` (до хоста не доезжают `FileSystemError`, `CancellationError`
и стек); отмену подключил только inline completions — остальные провайдеры
получают `neverCancelledToken()`, и после таймаута хоста language server
досчитывает в пустоту; таймауты навешаны снаружи (`raceWithTimeout`) и
сливают ошибку RPC с таймаутом без строки в логе; методы адресуются строками,
параметры на приёме кастуются руками.

Как в vscode: `SerializedError` (`base/common/errors.ts`), токен отмены в
каждом методе, типизированный протокол (`extHost.protocol.ts`). Полный
`ProxyIdentifier`/`Proxy` не берём — карта методов даёт ту же статическую
гарантию.

## План

1. [x] Формат ошибки (#513): `SerializedError`, `transformError{For,From}Serialization`,
   `CancellationError`/`isCancellationError` (`base/common/errorSerialization.ts`); `RpcEndpoint`
   переносит ошибку целиком.
2. [x] Таймаут как отмена (#515) в транспорте: `request(…, { token, timeoutMs })`,
   `raceWithTimeout` удаляется; таблица таймаутов вместо опций `*TimeoutMs`;
   ошибка и таймаут логируются раздельно.
3. [x] Токены отмены в субпроцессе (#518) вместо `neverCancelledToken`, логгер у
   `RpcEndpoint` субпроцесса, warn на исключение провайдера.
4. [x] Карта протокола (#519, #520, #522 и закрывающий PR): generic `RpcEndpoint<TOut, TIn>`,
   `extHostProtocol.ts` со всеми группами методов, алиасы `HostRpc`/`SubprocessRpc`
   без нетипизированного остатка; нотификация без обработчика — warn раз на метод,
   повторный `handleRequest` — `BugIndicatingError`.

## Не делаем

`Proxy`/`$`-акторы и `ProxyIdentifier`; удаление `parseWire*` (решение G5);
бинарный формат сообщений; детектор неотзывчивости хоста; бан will-save
участников по образцу upstream.
