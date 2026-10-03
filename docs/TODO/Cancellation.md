# Отмена и устаревание асинхронных запросов (H2)

Статус: `[~]`: общий latest-wins сделан, токен до провайдера ещё не проведён.

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

- [ ] **Токен до провайдера.** Билеты уже несут `token`, но до расширения он доезжает только у inline completions.
  Нужно провести его по цепочке: 9 сигнатур `*Source` (`editor/common/languages/`) → `ExtensionHost.provide*` →
  `rpc.request(method, params, token)` → общий `requestWithTimeout` в `wireTypes.ts` (собственный CTS поверх
  токена ядра, отмена при таймауте; сейчас так устроен только `requestInlineCompletions`) → `languagesNamespace.ts`
  (`toVscodeCancellationToken` вместо 11 `neverCancelledToken()`). Без этого tsserver и jdtls досчитывают
  запросы, ответ на которые мы уже выбросили. **Делать после G4/G5** (типизация RPC и дескриптор
  провайдера в wire-слое): иначе одну и ту же правку придётся вносить в 8 местах и потом переписывать.
  Обязательно проверить стоковый Java-сценарий (#367): `$/cancelRequest` у jdtls не должен ронять ответ на текущий
  запрос. Затем обновить `docs/arch/Extensions.md` («токеном пользуются ТОЛЬКО inline completions») и люфты в
  [Suggest.md](Suggest.md), [LSP.md](LSP.md).
- Не переводим, и это намеренно:
  - `diffSnapshotRefreshContribution.ts`: здесь latest-wins семантически неверен — нужно «доделать» или
    «слить пачки», а не «бросить старый». У него свой баг: новая пачка во время чтения бросает
    оставшиеся панели старой.
  - `services/search/node/fileSearchService.ts`: счётчик там служит кооперативной отменой обхода, перевод
    почти ничего не даёт.
