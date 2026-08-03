# Logging & Diagnostics

Подсистема логирования по модели VS Code: `ILogService` + `ILogger` per channel, fan-out по `ILogSink`.
Цель — единое место для диагностики всех подсистем (bootstrap, configuration, extensions, extension host, editor, …) с последующим UI типа Output-вкладки.

Готовое (инфраструктура, DI/bootstrap, миграция `console.*`, RPC-трейсинг extension host — Phases 1–3.5) описано в разделе **Common/Logging/** в [arch/Common.md](../arch/Common.md). Ниже — открытые фазы.

## Открытые фазы

- [x] **Phase 4 — Output UI**
  Вкладка OUTPUT в нижней Panel с выбором подсистемы. Обвязка повторяет VS Code:
  реестр каналов с человекочитаемыми именами (аналог `IOutputChannelRegistry`),
  содержимое — read-only редактор с языком `log` поверх detached-панели, селектор —
  submenu `switchOutput` в `MenuId.ViewTitle` с `isSelection`, активный канал
  помечен `toggled` по ключу `activeOutputChannel`.
  Осталось за рамками: фильтр по уровню, Clear Output, scroll-lock как команда,
  персист выбранного канала.

- [ ] **Phase 5 — Extension Host inner tracing**
  Внутри subprocess: пробросить `ILogger` в его `RpcEndpoint` (например, через стартовый `host.setLogLevel`-handshake), чтобы видеть исполнение handler'ов с той стороны.
  Патч `console.*` внутри subprocess → IPC сообщение `host.log`, родитель кладёт в канал `extensions.host.<extensionId>`. Сейчас console.* в subprocess летит в pipe stdout/stderr и попадает в каналы `.stdout`/`.stderr` без атрибуции расширению.

- [ ] **Phase 6 — CLI flags**
  `--log-level=<channel>=<level>` (repeatable, `*=info` по умолчанию), `--log-file=<path>`, `--no-log-file`.
  Парсинг в `CliArgs`, применение до создания sinks.

- [x] **Phase 7 — Public API для расширений** (LSP-итерация, PR #228)
  `vscode.window.createOutputChannel(name)` — настоящий канал: subprocess шлёт notify
  `output.append`/`output.show`, хост (`ExtensionOutputAdapter`) лениво регистрирует канал в
  `OutputChannelRegistry` (label = name) и пишет логгером. **Отступление от исходного плана:**
  id канала — `extensions.<slug(name)>` без `<extId>` (у subprocess-неймспейса нет per-call
  контекста расширения; вернуть extId — вместе с Phase 5). `OutputChannel.show()` — команда
  `workbench.action.output.show.<id>` (панель + переключение канала). `clear`/`replace` —
  no-op (журнал ретенционный).

## Принципы

- **Никаких прямых `console.*` в runtime** (после bootstrap-CLI). Тесты/explore — исключение.
- **Sinks не должны бросать**: ошибки логируются в `process.stderr` (если возможно) и проглатываются.
- **DEFAULT_LEVEL = Trace** — пока активная разработка, хочется видеть всё. Перед релизом снизить до Info через `setLevel("*", Info)`.
- **Channel naming**: `<area>` или `<area>.<sub>`; для расширений — `extensions.<id>`.
