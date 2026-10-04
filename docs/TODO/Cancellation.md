# Отмена и устаревание асинхронных запросов (H2)

Статус: `[~]`: общий latest-wins сделан, токен до провайдера проведён у hover/definition/references/signature help/completion/folding.

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

## Осталось

- [~] **Токен до провайдера.** Транспорт готов (G4): токен вызывающего уходит `$/cancelRequest`, субпроцесс
  отдаёт провайдеру настоящий `vscode.CancellationToken`. Проведён токен ядра у hover, definition, references,
  signature help, completion, folding: `*Source.provide*(request, token)` → `ExtensionHost.provide*` → опция `token` у
  `LanguageFeaturesCustomer.request`; сервисы отдают `ticket.token` своего `LatestRequest` (у completion и folding
  токен общий у пачки `ProviderRequestBatcher`). Осталось то же у formatting / range formatting, code actions
  (`provide`; `apply` без токена). Resolve пункта автодополнения — без токена намеренно: его ответ кэшируется и
  общий у панели описания и accept (правки авто-импорта), отменять его новым запросом нельзя; держит срок ответа.
  Обязательно проверить стоковый Java-сценарий (#367): `$/cancelRequest` у jdtls не должен ронять ответ на текущий
  запрос. Затем обновить люфты в [Suggest.md](Suggest.md), [LSP.md](LSP.md).
- Не переводим, и это намеренно:
  - `diffSnapshotRefreshContribution.ts`: здесь latest-wins семантически неверен — нужно «доделать» или
    «слить пачки», а не «бросить старый». У него свой баг: новая пачка во время чтения бросает
    оставшиеся панели старой.
  - `services/search/node/fileSearchService.ts`: счётчик там служит кооперативной отменой обхода, перевод
    почти ничего не даёт.
