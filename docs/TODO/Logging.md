# Logging & Diagnostics

Подсистема логирования по модели VS Code: `ILogService` + `ILogger` per channel, fan-out по `ILogSink`.
Цель — единое место для диагностики всех подсистем (bootstrap, configuration, extensions, extension host, editor, …) с последующим UI типа Output-вкладки.

Готовое (инфраструктура, DI/bootstrap, миграция `console.*`, RPC-трейсинг extension host,
Output UI, `createOutputChannel` для расширений) описано в разделе **Common/Logging/** в
[arch/Common.md](../arch/Common.md). Ниже — открытые фазы.

## Открытые фазы

- [ ] **Петля `diode.log` ↔ наблюдатель рабочей области** (нашлось 19.10.2026).
  При запуске из исходников `FileSink` пишет `./diode.log` в cwd
  (`src/vs/diode/main.ts`, только `!isPackagedRuntime()`); если cwd — открытая
  папка, git-расширение (watcher `**`) получает событие на каждую запись,
  событие уходит в субпроцесс и при дефолтном `Trace` логируется
  `extensions.host.rpc` — снова запись в `diode.log`. Поток ~раз в 50 мс, а
  обновление git — trailing debounce 200 мс с перезапуском на каждом событии
  (`extensions/git/main.ts`, `scheduleRefresh`): список Changes не обновляется,
  пока поток не прервётся (живой случай — внешняя правка ждала 70 с до Ctrl+S).
  Упакованные сборки не задеты (файла нет). Обход: `npm start -- --log
  extensions.host.rpc:info`. Починка: не пускать собственный лог-файл в
  наблюдатель рабочей области (или не логировать события о нём); заодно —
  предельное ожидание у debounce git-обновления, чтобы постоянный поток не
  откладывал его бесконечно. Снижение `DEFAULT_LEVEL` до `Info` (Phase 6)
  петлю тоже рвёт.

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
  применение — `LogService.setLevel` до первой записи.
  Осталось: `--log-file=<path>`, `--no-log-file` и снижение `DEFAULT_LEVEL` до `Info`
  (сейчас дефолт `Trace`, поэтому `--log` умеет только опускать планку).
