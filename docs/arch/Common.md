# Common/

Часть архитектуры Diode — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

Базовые типы и утилиты: геометрия (`Point`, `Size`, `Rect`, `BoxConstraints`), `IDisposable`/`Disposable`, DI-примитивы (`Token`, `Container`, см. [../DI.md](../DI.md)). Unicode: `UnicodeWidth` и `DisplayLine` (маппинг строки документа на grapheme-слоты + двусторонний конвертер offset↔column) — общий инструмент корректной обработки wide chars / emoji / табов / combining marks во всех слоях (Editor, TUIDom, RenderContext).

Слой не зависит от других слоёв проекта; leaf-библиотеки со стороны брать можно по политике зависимостей из [GOAL.md](../../GOAL.md) — так здесь живёт `Uri`.

## Uri
`Uri.ts` — идентичность ресурса (`scheme://authority/path?query#fragment`) и **единственный** способ адресовать ресурс в ядре и в extension host'е. Тонкий адаптер над `vscode-uri` — это upstream-реализация VS Code (`vs/base/common/uri.ts`, выделенная Microsoft в отдельный leaf-пакет, ноль транзитивных зависимостей), а не наш порт: семантика `fsPath`, percent-кодирования и Windows-путей полна нюансов. Адаптер добавляет ровно одно: статик `Uri.joinPath` (в `vscode-uri` он лежит в неймспейсе `Utils`, а расширения ждут `vscode.Uri.joinPath`); `Object.assign` сохраняет identity класса, поэтому `instanceof` внутри расширений работает. `Extensions/Host/Vscode/VscodeTypes.Uri` — ре-экспорт отсюда, один тип на оба процесса.

Правила адресации:
- **Ресурс = `Uri`, путь = производное.** Строкой путь остаётся только там, где он честный путь на диске: `UserDataPaths`, `StateService`, `KeybindingsService`, `ConfigurationService`, файловое дерево, персистентность сессии.
- **Подъём строки в `Uri` — в одной точке**, и `path.resolve` стоит вплотную перед `Uri.file`: `Uri.file` относительные пути НЕ резолвит (только префиксует `/`), поэтому резолвить после подъёма поздно. Для ядра эта точка — `EditorService.openFile`.
- **Сравнение — по `uri.toString()`**, а не `path.resolve(a) === path.resolve(b)`. Реестры ключуются строкой `uri.toString()`: `Map` не сравнивает `Uri` по значению, поэтому вопрос не «Uri или строка», а «какая строка» — каноничную даёт сам `Uri`.
- **Гейт дисковых операций — по `uri.scheme === "file"`**, а не по «путь непустой»: `fsPath` у не-file схемы не бросает, а возвращает путь как есть (`untitled:Untitled-1` → `"Untitled-1"`), и такой «путь» уйдёт в `node:fs` как относительный.

IO-абстракции (интерфейс + no-op/in-memory заглушка), которыми пользуются разные слои: `IClipboard`/`InMemoryClipboard`, `IFileClipboard`/`InMemoryFileClipboard`, `IFileWatcher`/`NULL_FILE_WATCHER` (слежение за отдельным файлом; реальная `ChokidarFileWatcher` и DI-токен `IFileWatcherDIToken` — в `Workbench/Services/`, но интерфейс живёт здесь, чтобы им мог пользоваться и слой Configuration для live-reload настроек). Разбор ошибок watcher'ов — `describeFileWatchError` (`src/vs/platform/files/common/fileWatchErrors.ts`): переводит ошибку (`ENOSPC`/`EMFILE` — упёрлись в лимит inotify) в код + подсказку по тюнингу; им пользуются оба реальных watcher'а (`ChokidarFileWatcher`, `ExplorerService`), чтобы текст рекомендации был один.

## Common/Assets/
Унифицированный доступ к статическим ассетам (грамматики, `onig.wasm`, манифесты builtin-расширений) через один интерфейс `IAssetAccess` над виртуальными POSIX-путями — потребители не знают, откуда физически читаются файлы. Две реализации: `BundleAssetAccess` (in-memory mini-archive) и `FsAssetAccess` (dev, mapping `virtualPrefix → fsRoot`). `CompositeAssetAccess` — longest-prefix роутер, склеивающий builtin- и user-ассеты в одно адресное пространство. Сборка bundle — `scripts/pack-assets.mjs`.

Три вида употребления ассетов:
- **in-memory** (`diode.bundle`) — читается целиком, файлы наружу не пишутся (грамматики, код builtin-расширений);
- **extract-to-tmp** (`rg.bundle`, `node-pty.bundle`) — распаковка в `os.tmpdir()` при первом использовании (`loadRipgrep`/`loadNodePty`; инвалидация по размеру ассета);
- **extract-to-cache** (`ts-server.bundle`) — распаковка в XDG-кэш (`cachePaths.userCacheDir()` → `~/.cache/diode/...`), переживает ребут; примитив — `base/node/assets/extractBundleToCache.ts`: версионированный ключ `<version>-<sha256>`, mkdir-lock как мьютекс, публикация атомарным rename с `.diode-ready` (схема self-extract-стаба), ожидание чужого лока с таймаутом. Потребитель — `loadTsServer.ts` (вшитый language-сервер).

`createDefaultAssetAccess()` выбирает источник **одного и того же** `diode.bundle` по убыванию приоритета:
1. **SEA** — бандл внутри бинаря, `node:sea.getAsset("diode.bundle")`;
2. **self-extract** — бандл лежит файлом рядом с `main.js` (`BundleFile.ts`; сборка — `scripts/build-selfextract.mjs`);
3. **dev/tests** — `FsAssetAccess` на `extensions/` + `node_modules/vscode-oniguruma`.

Формат и потребители у всех трёх общие — меняется только источник байтов, поэтому новый способ упаковки не стоит ничего ни одному downstream-потребителю.

## Common/Logging/
Логирование в стиле VS Code: один `ILogService` на процесс (`ILogServiceDIToken`), из него `ILogger` per channel (dotted, напр. `extensions.host`). Уровень канала резолвится walk-up по точкам → wildcard `*` → дефолт. Sinks (`ILogSink`) — fan-out fire-and-forget: `RingBufferSink` (источник для будущей Output-вкладки) и `FileSink` (append-only). В тестах биндится `NULL_LOG_SERVICE`.

Неочевидные гейты:
- **dev vs packaged:** `FileSink` (`./diode.log`) добавляется только когда `isPackagedRuntime() === false`; в упакованных сборках файлового sink нет. Гейт идёт именно по `isPackagedRuntime()` (`Assets/PackagedRuntime.ts`), а не по `isSeaBinary()`: self-extract — тоже прод, но `isSea()` там `false`, и по старому гейту прод писал бы `diode.log` в cwd пользователя.
- При `NULL_LOG_SERVICE` extension-host stdio остаётся `"inherit"` — семантика тестов не меняется.
- `isSeaBinary()` идёт через `createRequire(...)("node:sea")`: статический ESM-import `node:sea` **ломает SEA-сборку**.
