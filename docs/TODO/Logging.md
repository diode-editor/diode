# Logging & Diagnostics

Подсистема логирования по модели VS Code: `ILogService` + `ILogger` per channel, fan-out по `ILogSink`.
Цель — единое место для диагностики всех подсистем (bootstrap, configuration, extensions, extension host, editor, …) с последующим UI типа Output-вкладки.

Готовое (инфраструктура, DI/bootstrap, миграция `console.*`, RPC-трейсинг extension host,
Output UI, `createOutputChannel` для расширений) описано в разделе **Common/Logging/** в
[arch/Common.md](../arch/Common.md). Ниже — открытые фазы.

## Открытые фазы

- [ ] **Output UI — хвосты**: фильтр по уровню, Clear Output (сейчас `clear`/`replace`
  расширений — no-op, журнал ретенционный), scroll-lock как команда, персист
  выбранного канала.

- [ ] **Phase 5 — Extension Host inner tracing**
  Внутри subprocess: пробросить `ILogger` в его `RpcEndpoint` (например, через стартовый `host.setLogLevel`-handshake), чтобы видеть исполнение handler'ов с той стороны.
  Патч `console.*` внутри subprocess → IPC сообщение `host.log`, родитель кладёт в канал `extensions.host.<extensionId>`. Сейчас console.* в subprocess летит в pipe stdout/stderr и попадает в каналы `.stdout`/`.stderr` без атрибуции расширению. Тогда же вернуть `<extId>` в id каналов `createOutputChannel` (сейчас `extensions.<slug(name)>` — у subprocess-неймспейса нет per-call контекста расширения).

- [ ] **Phase 6 — CLI flags**
  `--log-level=<channel>=<level>` (repeatable, `*=info` по умолчанию), `--log-file=<path>`, `--no-log-file`.
  Парсинг в `CliArgs`, применение до создания sinks.

## Принципы

- **Никаких прямых `console.*` в runtime** (после bootstrap-CLI). Тесты/explore — исключение.
- **Sinks не должны бросать**: ошибки логируются в `process.stderr` (если возможно) и проглатываются.
- **DEFAULT_LEVEL = Trace** — пока активная разработка, хочется видеть всё. Перед релизом снизить до Info через `setLevel("*", Info)`.
- **Channel naming**: `<area>` или `<area>.<sub>`; для расширений — `extensions.<id>`.
