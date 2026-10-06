# Отмена и устаревание асинхронных запросов (H2)

Статус: `[x]`: общий latest-wins сделан, токен ядра доезжает до провайдера расширения.

## Сделано

- `base/common/cancellation.ts`: `CancellationTokenSource(parent?)`, `LatestRequest` / `IRequestTicket`
  (см. [docs/arch/Common.md](../arch/Common.md#отмена-и-устаревание-cancellationts)).
- `workbench/browser/parts/editor/editorStateCancellation.ts`: `EditorStateCancellationTokenSource(Value | Position)`,
  аналог upstream `editor/contrib/editorState`.
- Go to Definition больше не прыгает задним числом: ответ после правки, ухода каретки или повторного F12
  отбрасывается, как в upstream `goToCommands.ts`.
- Самодельные счётчики `requestSeq` заменены на `LatestRequest`: hover, suggest, parameter hints, references,
  inline completions (там вдобавок сведён дубль «счётчик + свой `CancellationTokenSource`»), валидация quick input,
  folding (`editorComponent.ts`), quick diff, панель поиска. Format Document сверяет не весь текст, а
  `EditorStateCancellationTokenSource(Value)`.
- Токен до провайдера (H2, 5–7/n). Транспорт готов с G4: токен вызывающего уходит `$/cancelRequest`, субпроцесс
  отдаёт провайдеру настоящий `vscode.CancellationToken`. Ядро проводит свой токен у всех pull-запросов
  языковых фич: `*Provider.provide*(request, token)` (`editor/common/languages/`) → прокси
  `LanguageFeaturesAdapter` → `ExtensionHost.provide*` → опция `token` у `LanguageFeaturesCustomer.request`.
  Откуда берётся токен:
  - hover, definition, references, signature help, completion, folding: `ticket.token` своего `LatestRequest`
    (перезапрос, закрытие попапа, уход каретки, правка, закрытие редактора); у completion и folding токен общий
    у пачки `ProviderRequestBatcher`. У completion это единственное, что ограничивает ожидание: срока ответа у
    него нет, поэтому запрос «в полёте» (попап ещё не открыт) отменяется и уходом каретки из слова, и уходом
    фокуса, и триггер-символом (`CompletionService.cancelRequestIfCaretLeft`);
  - Format Document / Selection: `EditorStateCancellationTokenSource(Value)`, правка буфера отменяет и форматтер.
- Без токена намеренно:
  - resolve пункта автодополнения: его ответ кэшируется и общий у панели описания и accept (правки авто-импорта),
    отменять его новым запросом нельзя; держит срок ответа;
  - команды code actions (organize imports, fix all, quick fix) и save-участники (format/code actions on save):
    отмены у них нет — команда разовая, а конвейер сохранения токена не знает; устаревший ответ format on save
    отбрасывает сверка версии;
  - `applyCodeAction`: применение не отменяют посреди правок.

## Не переводим на `LatestRequest`, и это намеренно

- `diffSnapshotRefreshContribution.ts`: здесь latest-wins семантически неверен — нужно «доделать» или
  «слить пачки», а не «бросить старый». У него свой баг: новая пачка во время чтения бросает
  оставшиеся панели старой.
- `services/search/node/fileSearchService.ts`: счётчик там служит кооперативной отменой обхода, перевод
  почти ничего не даёт.
