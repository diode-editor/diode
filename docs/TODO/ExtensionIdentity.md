# Идентичность расширения в extension host'е (G7)

Статус: `[~]` — PR1 (инфраструктура) сделан, PR2–PR4 впереди.

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
- [ ] PR2. Составные id output-каналов и пунктов статус-бара:
  `extensions.<owner>.<slug>` (`windowNamespace.ts`, `createOutputChannel`) и
  `<owner>.<id|slug|item-N>` (`createStatusBarItem`, как
  `asStatusBarItemIdentifier` эталона). Тесты output/statusBar, e2e
  `gotoDefinition`/`inlineCompletionCancel`, доки LSP.md и Logging.md;
  осиротевшие скрытые пункты статус-бара — в описании PR.
- [ ] PR3. Владелец в регистрациях и логах провайдеров: `owner` в
  `registerByHandle`, `reportProviderFailure(method, err, owner?)` →
  `[ext-host] [<id>] <method> failed`; лог в `runActionCommand` вместо
  `catch {}`; владелец в локальных командах (`commandsNamespace.ts`) для лога
  сбоя команды.
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

- `languages.createDiagnosticCollection`: owner `"ext:" + (name ?? "diagnostics")`
  без уникализации — одноимённые коллекции затирают маркеры друг друга
  (эталон уникализирует имя).
- `DiagnosticCollection.dispose` не убирает store из `diagnosticStores` —
  утечка и мёртвый store в контексте code actions.
- Output-канал с именем «Host» получает id `extensions.host` — тот же, что у
  логгера хоста.
- Ошибки `dispose` подписок и `deactivate()` при выключении глотаются без имени
  расширения (`extensionHostSubprocess.ts`).
