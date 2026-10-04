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
  Патч `console.*` внутри subprocess → IPC сообщение `host.log`, родитель кладёт в канал `extensions.host.<extensionId>`. Сейчас console.* в subprocess летит в pipe stdout/stderr и попадает в каналы `.stdout`/`.stderr` без атрибуции расширению. `<extId>` в id каналов `createOutputChannel` уже есть (G7: `extensions.<extId>.<slug(name)>`, владелец — из оверлея API расширения).

- [~] **Phase 6 — CLI flags**
  Уровни сделаны в форме эталона: `--log <level>` (для всех каналов) и
  `--log <channel>:<level>` (например `extensions.host:debug`), флаг повторяемый,
  плюс `--verbose` ≡ `--log trace`. Парсинг — `parseCliArgs` (`ILogLevelRule[]`),
  применение — `LogService.setLevel` до первой записи (см. [Startup](Startup.md)).
  Осталось: `--log-file=<path>`, `--no-log-file` и снижение `DEFAULT_LEVEL` до `Info`
  (сейчас дефолт `Trace`, поэтому `--log` умеет только опускать планку).

## Принципы

- **Никаких прямых `console.*` в runtime** (после bootstrap-CLI). Тесты/explore — исключение.
- **Sinks не должны бросать**: ошибки логируются в `process.stderr` (если возможно) и проглатываются.
- **DEFAULT_LEVEL = Trace** — пока активная разработка, хочется видеть всё. Перед релизом снизить до Info через `setLevel("*", Info)`.
- **Channel naming**: `<area>` или `<area>.<sub>`; для расширений — `extensions.<id>`.
