# Идентичность расширения в extension host'е (G7)

Статус: `[~]` — PR1 (инфраструктура), PR2 (составные id) и PR3 (логи провайдеров) сделаны, PR4 (необязательный) впереди.

В субпроцессе extension host'а один объект `vscode` на все расширения, поэтому
ни один вызов API не знает, какое расширение его сделало. Отсюда коллизии
идентификаторов (одноимённые output-каналы двух расширений сливаются, пункты
статус-бара без id скрываются вместе), ошибки провайдеров без имени виновника,
заблокированная фаза 5 [Logging](Logging.md) (лог-канал на расширение) и
будущие API с маршрутизацией по id (`window.registerUriHandler`).

Подход — «окружающий владелец»: индекс корней расширений + тонкий оверлей
поверх ОБЩЕГО namespace. Оверлей знает id расширения и на время синхронных
«создающих» вызовов (`createOutputChannel`, `register*Provider`,
`registerCommand`, …) выставляет `IVscodeHostContext.owner` через
`ExtensionOwner.runAs`; общие фабрики читают владельца в момент создания.
Устройство — [docs/arch/Extensions.md](../arch/Extensions.md) (пункт
«Идентичность расширения»).

## План

- [x] PR1. Индекс путей + оверлей + резолв по импортёру, без смены
  наблюдаемого поведения: `api/common/extensionPaths.ts` (самый длинный
  корень-предок, realpath корня), `ExtensionOwner` в `vscodeHostContext.ts`,
  `api/common/extensionApiFactory.ts` (`forPath`/`forId` с кэшем, неопознанный
  импортёр — общий namespace и одно предупреждение, ESM-шим с id). CJS
  `_resolveFilename` → `vscode:<id>` по `parent.filename`, ESM-хук →
  `diode-vscode:api/<id>` по `parentURL`; индекс наполняется из
  `extensions.catalog` и в `host.activateExtension` до загрузки модуля.
  Общие фабрики владельца пока не читают.
- [x] PR2. Составные id output-каналов и пунктов статус-бара:
  `extensions.<owner>.<slug>` (`windowNamespace.ts`, `createOutputChannel`) и
  `<owner>.<id|slug|item-N>` (`createStatusBarItem`, как
  `asStatusBarItemIdentifier` эталона; владелец фиксируется при создании, id
  ленивый). Без владельца (вызов мимо оверлея) — прежние формы. Канал
  расширения «Host» больше не сталкивается с логгером хоста `extensions.host`.
  e2e `gotoDefinition`/`inlineCompletionCancel`/`statusBarExtension`. Скрытые
  пользователем пункты статус-бара со старыми id осиротели — их придётся
  скрыть заново.
- [x] PR3. Владелец в регистрациях и логах провайдеров: `owner` в
  `registerByHandle` (и в кэше completion-resolve), `reportProviderFailure` →
  `[ext-host] [<id>] <method> failed` (без владельца — как прежде); упавшая
  команда code action — в stderr вместо `catch {}`; предупреждение
  `registerTextEditorCommand` без редактора — с id. Своего лога сбоя команды в
  субпроцессе нет (сбой едет хосту ответом RPC, `CommandRegistry` пишет его
  без id — по проводу владелец хосту не нужен). Попутно закрыты пункты
  диагностик и уборки из списка ниже.
- [ ] PR4 (опционально). Атрибуция по стеку тем же индексом:
  `unhandledRejection`/`setUnexpectedErrorHandler`, `console.*` расширения →
  канал `extensions.host.<id>`.

## Не делаем

- Полная фабрика API на расширение (свои экземпляры неймспейсов и
  RPC-обработчиков на каждое расширение, как `createApiFactoryAndRegisterActors`
  эталона): обработчики RPC живут внутри фабрик неймспейсов, вынос их в общие
  сервисы — переписывание ~5 тыс. строк ради того, что оверлей даёт за пару
  сотен.
- Автоснятие регистраций при деактивации — у эталона то же самое (только
  `subscriptions`), живой выгрузки расширения у нас нет.

## Попутно найдено (вне G7)

- [x] `languages.createDiagnosticCollection`: owner `"ext:" + (name ?? "diagnostics")`
  без уникализации — одноимённые коллекции затирали маркеры друг друга.
  Теперь `ext:<id>:<имя>` + `#N` на повтор (PR3).
- [x] `DiagnosticCollection.dispose` не убирал store из `diagnosticStores` —
  утечка и мёртвый store в контексте code actions (PR3).
- [x] Output-канал с именем «Host» получал id `extensions.host` — тот же, что у
  логгера хоста. Теперь `extensions.<id>.host` (PR2); вызов мимо оверлея — по-прежнему.
- [x] Ошибки `dispose` подписок и `deactivate()` при выключении глотались без
  имени расширения (`extensionHostSubprocess.ts`). Теперь warn с id
  (`extensionDeactivation.ts`, PR3).
