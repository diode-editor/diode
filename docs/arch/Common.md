# Common/

Часть архитектуры Diode — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

Базовые типы и утилиты: геометрия (`Point`, `Size`, `Rect`, `BoxConstraints`), `IDisposable`/`Disposable` (`lifecycle.ts`, см. ниже), DI-примитивы (`Token`, `Container`, см. [../DI.md](../DI.md)). Unicode: `UnicodeWidth` и `DisplayLine` (маппинг строки документа на grapheme-слоты + двусторонний конвертер offset↔column) — общий инструмент корректной обработки wide chars / emoji / табов / combining marks во всех слоях (Editor, TUIDom, RenderContext).

Слой не зависит от других слоёв проекта; leaf-библиотеки со стороны брать можно по политике зависимостей из [GOAL.md](../../GOAL.md) — так здесь живёт `Uri`.

## Uri
`Uri.ts` — идентичность ресурса (`scheme://authority/path?query#fragment`) и **единственный** способ адресовать ресурс в ядре и в extension host'е. Тонкий адаптер над `vscode-uri` — это upstream-реализация VS Code (`vs/base/common/uri.ts`, выделенная Microsoft в отдельный leaf-пакет, ноль транзитивных зависимостей), а не наш порт: семантика `fsPath`, percent-кодирования и Windows-путей полна нюансов. Адаптер добавляет ровно одно: статик `Uri.joinPath` (в `vscode-uri` он лежит в неймспейсе `Utils`, а расширения ждут `vscode.Uri.joinPath`); `Object.assign` сохраняет identity класса, поэтому `instanceof` внутри расширений работает. `Extensions/Host/Vscode/VscodeTypes.Uri` — ре-экспорт отсюда, один тип на оба процесса.

Правила адресации:
- **Ресурс = `Uri`, путь = производное.** Строкой путь остаётся только там, где он честный путь на диске: `UserDataPaths`, `StateService`, `KeybindingsService`, `ConfigurationService`, файловое дерево, персистентность сессии.
- **Подъём строки в `Uri` — в одной точке**, и `path.resolve` стоит вплотную перед `Uri.file`: `Uri.file` относительные пути НЕ резолвит (только префиксует `/`), поэтому резолвить после подъёма поздно. Для ядра эта точка — `EditorService.openFile`.
- **Сравнение — по `uri.toString()`**, а не `path.resolve(a) === path.resolve(b)`. Реестры ключуются строкой `uri.toString()`: `Map` не сравнивает `Uri` по значению, поэтому вопрос не «Uri или строка», а «какая строка» — каноничную даёт сам `Uri`. Строку **извне** (ответ провайдера расширения, LSP, аргумент команды) с ней напрямую не сравнивают: сначала `Uri.parse(s).toString()` — у `jdt:`-ссылок redhat.java `Uri.parse(s).toString() !== s` (query перекодируется), и сравнение сырых строк уводило каретку мимо строки определения, а `ProblemsComponent.revealMarker` без сверки ресурса — в чужой активный редактор (#363). Повторный `parse` уже стабилен.
- **Гейт дисковых операций — по `uri.scheme === "file"`**, а не по «путь непустой»: `fsPath` у не-file схемы не бросает, а возвращает путь как есть (`untitled:Untitled-1` → `"Untitled-1"`), и такой «путь» уйдёт в `node:fs` как относительный.

IO-абстракции (интерфейс + no-op/in-memory заглушка), которыми пользуются разные слои: `IClipboard`/`InMemoryClipboard`, `IFileClipboard`/`InMemoryFileClipboard`, `IFileWatcher`/`NULL_FILE_WATCHER` (слежение за отдельным файлом; реальная `ChokidarFileWatcher` и DI-токен `IFileWatcherDIToken` — в `Workbench/Services/`, но интерфейс живёт здесь, чтобы им мог пользоваться и слой Configuration для live-reload настроек). Разбор ошибок watcher'ов — `describeFileWatchError` (`src/vs/platform/files/common/fileWatchErrors.ts`): переводит ошибку (`ENOSPC`/`EMFILE` — упёрлись в лимит inotify) в код + подсказку по тюнингу; им пользуются оба реальных watcher'а (`ChokidarFileWatcher`, `ExplorerService`), чтобы текст рекомендации был один.

## Отмена и устаревание: `cancellation.ts`

Шим upstream `vs/base/common/cancellation.ts`: `ICancellationToken`, `CancellationTokenNone`,
`CancellationTokenSource(parent?)` — отмена родителя отменяет источник, `dispose()` снимает слушателей
и подписку на родителя, не отменяя. Поверх — наш `LatestRequest` («последний запрос побеждает»):
`start(parent?)` отменяет прежний запрос и выдаёт билет `{ token, isStale(), done() }`, `cancel()` —
замена `requestSeq++` в `close()`. Асинхронный запрос UI пишется так: `const ticket = latest.start();
await …; if (ticket.isStale()) return;` — а не рукописным счётчиком поколений, и токен билета
доезжает до исполнителя. Привязки к документу в хелпере нет (base про документ не знает): «отменить
на правку/движение каретки» — `EditorStateCancellationTokenSource` в workbench (см. Workbench.md).

## Жизненный цикл: `lifecycle.ts`
`vs/base/common/lifecycle.ts` — примитив освобождения ресурсов, аналог одноимённого файла vscode (наш код, а не дословный перенос; план и обоснование — [../TODO/Lifecycle.md](../TODO/Lifecycle.md)):
- `IDisposable`, `isDisposable`, `dispose(x | iterable)` (освобождает всех, ошибки — в конце, несколько — `AggregateError`), `toDisposable(fn)` (функция зовётся не больше раза), `combinedDisposable`;
- `DisposableStore` — набор вместо `IDisposable[]` с ручным циклом; `Disposable` — база класса-владельца поверх стора (`register(…)`, `Disposable.None`);
- `MutableDisposable` — слот под сменяемое значение вместо поля `handle?.dispose()`; `DisposableMap` — карта, освобождающая значения при перезаписи и удалении;
- учёт утечек: хуки (`setDisposableTracker`, `trackDisposable`, `markAsDisposed`, `markAsSingleton`) — по умолчанию трекера нет, хук стоит одной проверки на `null`; `DisposableTracker` помнит живые объекты и их владельцев и отдаёт утёкшие корни со стеком создания. В тестах включается на сьют хелпером `ensureNoDisposablesAreLeakedInTestSuite` (см. [../TESTING.md](../TESTING.md#учёт-утечек-testutilsdisposableleaksts)).

Отклонения от эталона: освобождение в обратном порядке добавления (LIFO — так работал прежний класс из `@tuidom/core`, под него писались классы проекта), `register` без подчёркивания, добавление в уже освобождённый стор (и `register` у освобождённого `Disposable`) освобождает объект сразу — эталон предупреждает и оставляет утекать.

## Отложенный запуск: `async.ts`

Шим upstream `vs/base/common/async.ts`, только `RunOnceScheduler`: `schedule(delay?)` перезаводит таймер,
функция выполняется однажды через задержку после последнего вызова; `cancel()`, `isScheduled()`,
`dispose()` (после него функция не выполнится). Вместо поля `timer` с парой «запланировать/отменить» в
каждой фиче. Остальные примитивы upstream (`Delayer`, `Throttler`, `createCancelablePromise`) не
заводим, пока нет потребителя.

## События: `event.ts`
`vs/base/common/event.ts` — `Emitter<T>`/`Event<T>` с именами эталона vscode, но свой узкий код (шим, план миграции — [../TODO/Events.md](../TODO/Events.md)). Событие — функция подписки `(listener) => IDisposable`; владелец держит эмиттер приватным и отдаёт поле `event`:

```ts
private readonly onDidChangeEmitter = new Emitter<string>();
public readonly onDidChange = this.onDidChangeEmitter.event;
```

Гарантии: подписавшийся во время `fire` в нём не зовётся (copy-on-write, без копии на `fire`); снятый во время `fire` и ещё не достигнутый — не зовётся; исключение слушателя уходит в `onListenerError ?? onUnexpectedError`, остальные событие получают; `dispose()` снимает всех; хуки `onWillAddFirstListener`/`onDidRemoveLastListener`. Комбинаторы — `Event.None`, `Event.once`, остальные по мере надобности. Не берём от эталона очередь доставки (вложенный `fire` идёт вглубь), монитор утечек и `thisArgs`/`disposables` в сигнатуре.

`onUnexpectedError` (`errors.ts`) в проде уходит в лог (`main.ts`, субпроцесс extension host'а), в тестах — роняет тест (см. [../TESTING.md](../TESTING.md)).

## Шелл системы: `base/node/shell.ts`

`getSystemShell(platform?, env?)` — единственная точка «какой шелл запускать» (upstream `base/node/shell.ts`):
unix — `$SHELL` → шелл учётной записи (`os.userInfo()`) → `sh`, `/bin/false` заменяется на `/bin/bash`;
win32 — `%COMSPEC%` → `cmd.exe` (обнаружения PowerShell нет). Встроенный терминал спавнит его в
`EmbeddedTerminalSession` и отдаёт полем `shell` сессии — по нему вкладка получает заголовок; browser-слой
`process.env.SHELL` не читает.

## Дочерние процессы: `base/node/childProcessGuard.ts`, `selfSpawnArgs.ts`

`GuardedChildProcess(child, { label, logger?, logStderr?, waitForStdio? })` — принадлежащий нам дочерний
процесс под правилами «Ролей процессов» (ARCHITECTURE.md): `error` через `on`, `error` без `exit` — тоже конец,
слушатель `error` на каждом stdio-потоке, `onDidEnd` ровно один раз (`exit`, или `close` при `waitForStdio`, или
`error`), `dispose` — синхронный SIGKILL. Политику (рестарт, сброс состояния) решает владелец в слушателе
`onDidEnd`. `splitLines(stream, onLine)` — общий построчный разбор потока. `spawnSelfAsRole(role, { stdout?,
stderr })` — запуск себя в роли (`DIODE_FILE_WATCHER`, `DIODE_EXTENSION_HOST`): флаг роли в env, IPC-канал,
stdio без `inherit` (типом). Пользователи — watcher-процесс (`SubprocessTreeWatcher`) и разовый спавн rg в поиске по файлам (`services/search/node`).

## Надёжность процесса: что не должно его ронять

Сквозные правила; каждое уже стоило падения редактора или субпроцесса расширений.

- **Свой дочерний процесс — только через `GuardedChildProcess`** (выше). `error` у `ChildProcess` слушается обязательно и подпиской `on`, а не `once`; `try/catch` вокруг `send` не спасает (закрытый канал отвечает `false` синхронно, `ERR_IPC_CHANNEL_CLOSED` приходит событием позже), а после `error` событие `exit` может не прийти вовсе ([ARCHITECTURE.md](../ARCHITECTURE.md#роли-процессов-форк-самого-себя)).
- **Команда не роняет процесс.** Обработчик команды возвращает свой промис, а не `void`; `CommandRegistry.execute` вешает обработчик отказа на исходный промис, не подменяя его (ждущему отказ обязан доехать); `openUri` не отклоняется никогда; последняя страховка — `process.on("unhandledRejection")` в `main.ts` и в субпроцессе расширений ([TODO/Uri.md](../TODO/Uri.md#виртуальные-read-only-документы-сделано)).
- **Отказ host-обработчика RPC — это отказ промиса у расширения**, и необработанный отказ в коде расширения бьёт по всему субпроцессу. Поломка нашей поверхности (сток бросил) расширению стоить не должна: нейтральный ответ + строка в лог (образец — `window.showMessage` в `services/extensions/node/customers/windowCustomer.ts`).
- **Отсутствующая зависимость — null-объект, а не `undefined`** (`NULL_LOGGER`, `NULL_LANGUAGE_SERVICE`, `NULL_FILE_WATCHER`, `NULL_VIRTUAL_DOCUMENT_SOURCE`); обработчик отказа — хвостом `.catch(...)`, а не вторым аргументом `then`. Обе формы убирают ветки, которые иначе дают `RuntimeError` мутанта или эквивалентного выжившего ([TESTING.md](../TESTING.md), «Раннер упал на мутанте»).

## Верхний уровень модулей и V8-снапшот

SEA-бинарь стартует из V8-снапшота ядра (`useSnapshot` в `scripts/build-sea.mjs`): при сборке
`dist/main.cjs` исполняет **только верхний уровень модулей** и регистрирует вход
`v8.startupSnapshot.setDeserializeMainFunction` (`src/vs/diode/main.ts`), а пользователю приезжает
готовая куча. Верхний уровень исполняется один раз — на машине CI, а не у пользователя. Без
снапшота (self-extract, `node dist/main.cjs`, dev) тот же код идёт обычным порядком, поэтому
нарушение в dev не видно.

Вход сборки снапшота — не сам `main.cjs`, а `scripts/snapshot-entry.cjs` (SEA и гейт). Он исполняет
`main.cjs` с теми же `require`/`__filename`/`__dirname`, но компилирует его eagerly (`vm.Script` под
`--no-lazy` только на эту компиляцию). Байткод всех функций бандла лежит в блобе, и путь старта у
пользователя не компилируется лениво. Исполнение верхнего уровня от этого не меняется, правила ниже
те же.

На уровне модуля (и в синглтонах, которые верхний уровень успевает разбудить) **нельзя**:

- **читать окружение процесса в константу**: `process.env`, `process.argv`, `process.execPath`,
  `process.cwd()` (и `path.resolve` от него), `os.homedir()`/`tmpdir()`/`userInfo()`/`hostname()`,
  `process.stdout`/`stdin` и размеры терминала, `isSeaBinary()` в кэш. Значение запечётся с машины
  сборки и молча врёт у пользователя: сборка от этого не падает. Захваченный объект `process.env`
  живой (он и после десериализации видит env запуска), а захваченный массив `process.argv` — нет;
  `process.platform`/`arch` можно: блоб собирается на целевой платформе;
- **время и случайность**: `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()`,
  `performance.now()` — у всех пользователей были бы одни и те же. `performance.timeOrigin` после
  десериализации свой, вехи старта (`mark`) считают от старта процесса;
- **таймеры** (`setTimeout`, `setInterval`, `setImmediate`): при сборке они срабатывают у сборщика;
- **нативные объекты**: `Intl.*` (сегментер, коллатор), парсеры, сокеты, watcher'ы, `node:http` —
  сборка снапшота падает (`global handle not serialized: [Foreign]`). Создавать при первом вызове.

Можно: объявлять классы, функции, таблицы-литералы, регэкспы, регистрировать в реестрах (команды,
цвета, конфигурацию) — это и есть то, что снапшот экономит. Окружение читается в функции, которая
вызывается из `start()` в `main.ts` или позже; ленивый синглтон — инициализировать при первом
обращении из рантайма, а не с верхнего уровня.

**Гейт** — `npm run snapshot-check` (`scripts/check-snapshot.mjs`, CI job `static`, ~5 с):

1. ловушки (`scripts/snapshot-audit-prelude.cjs` перед `main.cjs`) на всё перечисленное выше —
   нарушение называет вызов и модуль бандла (`// src/...` esbuild). Осознанные исключения —
   `ALLOWED_TOP_LEVEL` с причиной (сейчас одно: `VSCODE_TEXTMATE_DEBUG` у vscode-textmate);
2. отравленная сборка: снапшот настоящего `main.cjs` собирает node из каталога с меткой, в cwd с
   меткой, с метками в HOME, TMPDIR, XDG_*, PATH, TERM, LANG, argv. Меток в блобе не больше, чем
   у пустого снапшота того же node — иначе окружение сборки запеклось в куче (ловит и то, что
   прошло мимо ловушек: ленивый синглтон, чтение внутри node);
3. поведение после десериализации того же блоба в чистом окружении: `--version`, CLI расширений
   пишет в HOME запуска, run-as-node (`-e` и скрипт с относительным `require`) видит argv, cwd,
   HOME, TMPDIR запуска и выводит то же, что без снапшота.

Что гейт не видит — поведение настоящего бинаря (ассеты SEA, роли, куски с кэшем кода): это e2e на
SEA и самотест `build-sea.mjs` на каждой SEA-платформе релиза (`build.yml`: linux x64/arm64, macOS
arm64, Windows; блоб платформенно-зависим и собирается на целевой машине). Self-extract (только
macOS Intel, #143/#144) стартует без снапшота — верхний уровень там исполняется у пользователя, но
правила те же. Сборочный node — не ниже 26.11: в процессе из снапшота старые роняют воркер с
`node:net`. Записка с замерами — шаг 6 [OpenPerformance.md](../TODO/OpenPerformance.md).

## Вехи старта: `performance.ts`

`mark(name, detail?)` — тонкая обёртка над стандартным `performance.mark` (аналог
`vs/base/common/performance.ts` upstream). Метки стоят по всему пути открытия файла
(`diode/main.ts` → workbench → `textfile`), но **без включения это no-op**: в обычном запуске
ничего не пишется, стоимость вызова — одна проверка флага. Включает запись
`src/vs/diode/startupTrace.ts` по env `DIODE_STARTUP_TRACE=<файл>`; он же по завершении старта
выгружает метки одним JSON (плюс `performance.nodeTiming` и `timeOrigin`), а под трассой
терминальный бэкенд (`TracingNodeTerminalBackend`) ставит веху `frame` на каждый кадр, ушедший в
терминал. Потребитель — бенч открытия файла `e2e/bench/benchOpen.ts`: лестница вех печатается
рядом с чёрным ящиком (таймстемпы чанков PTY). Имена меток — `<область>:<веха>`
(`main:config-loaded`, `textfile:read`, `editor:tokenizer-ready`); в `editor/common` меток нет —
чтение диска и построение документа размечает владелец модели в workbench (`TextFileModel`).
План и что меряется — [TODO/OpenPerformance.md](../TODO/OpenPerformance.md).

**Трасса созданий DI** (аналог `Trace` в `instantiationService.ts` и таблицы контрибуций «Developer:
Startup Performance» эталона) — поверх вех, по второму флагу `DIODE_STARTUP_TRACE_INSTANTIATIONS=1`.
`Container.get` (`platform/instantiation/common/instantiationTrace.ts`) пишет каждое создание:
токен, старт, inclusive и self (без вложенных созданий), кто запросил (токен-родитель,
`contributions:<фаза>` или первая функция стека за контейнером) и фазу контрибуций; реестр
контрибуций помечает свои создания. Выгрузка — поле `instantiations` того же JSON. Отдельным флагом,
потому что запись не бесплатна (≈2 мс на CI в окне DI, стек вызывателя форматируется лениво, при
выгрузке), а бенч и перф-гейт всегда идут под трассой. Без флага цена — одна проверка на промахе
кэша контейнера (микробенч: единицы мкс на 200 созданий). Таблица:

```bash
npm run bench:open -- --sizes=small --runs=15 --keep-traces=/tmp/traces   # трассы с флагом
npm run bench:services -- /tmp/traces/*.json [--sort=self|inclusive|start] [--top=40] [--min=0.3]
```

`bench:services` (`e2e/bench/startupServices.ts`) печатает медианы по трассам: сумму созданий по
окнам лестницы, контрибуции в порядке создания и создания по self. Время вне DI (рендер, `new` мимо
контейнера, компиляция) таблица не видит — это CPU-профиль и вехи.

## Common/Assets/
Унифицированный доступ к статическим ассетам (грамматики, `onig.wasm`, манифесты builtin-расширений) через один интерфейс `IAssetAccess` над виртуальными POSIX-путями — потребители не знают, откуда физически читаются файлы. Две реализации: `BundleAssetAccess` (in-memory mini-archive) и `FsAssetAccess` (dev, mapping `virtualPrefix → fsRoot`). `CompositeAssetAccess` — longest-prefix роутер, склеивающий builtin- и user-ассеты в одно адресное пространство. Сборка bundle — `scripts/pack-assets.mjs`.

Два вида употребления ассетов:
- **in-memory** (`diode.bundle`) — читается целиком, файлы наружу не пишутся (грамматики, код builtin-расширений);
- **extract-to-cache** (`rg.bundle`, `node-pty.bundle`, `ts-server.bundle`) — распаковка в XDG-кэш при первом использовании (переживает ребут). Чтение байтов — `base/node/assets/packagedAsset.ts` `readPackagedAsset(name)`: SEA → `node:sea.getAsset`, self-extract → файл рядом с `main.cjs`, dev → `null` (потребитель берёт node_modules). Каталог — `packagedAssetCacheDir(kind, bytes)` = `<userCacheDir>/<kind>/<version>-<sha256[0:12]>` (ключ по содержимому, не по размеру). Распаковка — `extractBundleToCache` / `extractBundleToCacheSync` (`base/node/assets/extractBundleToCache.ts`): mkdir-lock как мьютекс, публикация атомарным rename с `.diode-ready` (схема self-extract-стаба), ожидание чужого лока с таймаутом, `executable` — какие файлы получить `0o755` до публикации. Потребители — `loadRipgrep.ts` (sync: спавн из синхронного `search()`), `loadNodePty.ts` (sync: PTY в конструкторе сессии), `loadTsServer.ts` (async, вшитый language-сервер).

`createDefaultAssetAccess()` выбирает источник **одного и того же** `diode.bundle` по убыванию приоритета:
1. **SEA** — бандл внутри бинаря, `node:sea.getAsset("diode.bundle")`;
2. **self-extract** — бандл лежит файлом рядом с `main.cjs` (`BundleFile.ts`; сборка — `scripts/build-selfextract.mjs`);
3. **dev/tests** — `FsAssetAccess` на `extensions/` + `node_modules/vscode-oniguruma`.

Формат и потребители у всех трёх общие — меняется только источник байтов, поэтому новый способ упаковки не стоит ничего ни одному downstream-потребителю.

### Ленивые куски бандла
Третий вид ассета — **код**: зависимость, которая не нужна до первого кадра, не лежит в `dist/main.cjs`, а собирается отдельным самодостаточным CJS-файлом `lazy/<id>.cjs` и парсится только при первом обращении к фиче (этап 1 [OpenPerformance.md](../TODO/OpenPerformance.md): каждый вынесенный МБ — меньше парса на старте и меньше кучи в будущем снапшоте). Сейчас вынесены `yauzl` (установка `.vsix`), `semver` (магазин: разбор реестра, совместимость `engines`), `@xterm/headless` (VT-эмулятор встроенного терминала), `iconv-lite` (кодировки кроме utf-8 и UTF-16: те `encoding.ts` декодирует нативно, а кусок грузит первый Reopen/Save with Encoding в такой кодировке) и наш код — роли процесса `roles/extension-host` и `roles/file-watcher` (см. ниже «Кусок из нашего кода»).

- **Список** — `LAZY_CHUNKS` в `scripts/build-lazy-chunks.mjs`. Из него берут всё остальное: `tsup.config.ts` объявляет `id` внешним (в `main.cjs` остаётся голый `import("<id>")`), `build-dist.mjs` собирает куски esbuild'ом (`format: cjs`, `platform: node`) в `<dist>/lazy/`, `build-sea.mjs` вшивает их ассетами `lazy/<id>.cjs`, `build-selfextract.mjs` кладёт файлами рядом с `main.cjs`.
- **Загрузчик** — `loadLazyModule(id, () => import("<id>"))` (`base/node/lazyModule.ts`). Байты — через `readPackagedAssetView` (SEA → ассет без копии, `sea.getRawAsset`; self-extract и `node dist/main.cjs` → файл рядом с `main.cjs`); кусок компилируется `vm.Script` над CJS-обёрткой-выражением (`LAZY_CHUNK_WRAPPER`) с настоящим `require` от `createRequire(process.execPath)` (кусок тянет только builtin'ы). Куска нет (tsx, vitest, голый `npm run build`) — работает `importer`, обычный `import()` из node_modules. Результат имеет форму пространства имён `import()` над CJS (`default` = `module.exports`), загрузка одна на процесс, сбой не залипает.
- **Кусок в common-коде** — `importLazyModule(id, () => import("<id>"))` из `base/common/lazyModule.ts`. Это контракт без реализации: common не может импортировать `base/node` (`valid-layers-check`), поэтому node-загрузчик подставляет точка входа — `setLazyModuleLoader(loadLazyModule)` в начале `src/vs/diode/main.ts`, до ветвления по ролям процесса. Без подстановки (vitest) работает `importer`. Так же устроено в эталоне: common-код vscode берёт iconv и xterm асинхронным `importAMDNodeModule` из `vs/amdX.ts`, а откуда приходит модуль, решает окружение. node-код может звать `loadLazyModule` напрямую (yauzl).
  - **Синхронный потребитель** (semver: валидация версий в парсерах реестра, `satisfies`/`gt` в выборе версии) получает модуль **параметром** типа `typeof import("<id>")`. Модуль добывает асинхронная граница фичи (`await loadSemver()` в источнике реестра, установке, загрузке каталога) и передаёт его дальше. Забыть загрузку нельзя — без модуля функцию не вызвать, ошибка ловится типами, а не в рантайме. Асинхронный потребитель делает `await importLazyModule(...)` сам, как `encoding.ts` в эталоне: у нас `decodeBuffer`/`encodeText` грузят iconv только для кодировок кроме utf-8 и UTF-16. Синхронному пути фичи, который нельзя сделать асинхронным (`openFile` у `TextFileModel`), кусок не нужен вовсе: BOM-сниф даёт только Unicode, его декодирует нативный `decodeBufferByBOM`. Это третий приём, наравне с параметром и швом внутри объекта: быстрый путь без куска, эквивалентный ему байт в байт (тесты «native codecs == iconv-lite»).
  - **Отвергнутые варианты.** Расщепить файлы (функции с semver уезжают в `node/`) — годится для semver, у которого все вызывающие в `node/`, но не для iconv: его зовут `textFileModel.ts` (common) и `browser/`-части. Синхронный геттер (`get()` бросает, если не загружено) — меньше правок в сигнатурах, но забытый `await` на шве всплывает в рантайме, ровно та гонка, которую распил обязан не плодить. DI-токен не дотягивается до чистых функций формата.
- **Гейт на граф первого кадра** — `verifyLazyChunks` по metafile esbuild: модули куска не лежат в `main.cjs` (статический импорт ядра затянул бы их обратно), `main.cjs` зовёт кусок только `import()`, кусок не тянет внешних не-builtin модулей (в SEA их нет). Запуск — `npm run lazy-chunks-check` (секунды, CI job `static`); та же проверка роняет настоящую сборку в `build-dist.mjs`.
- **Новая часть распила**: запись в `LAZY_CHUNKS`, загрузка на шве фичи (`loadLazyModule` в node-коде, `importLazyModule` в common), убрать пакет из `noExternal` в `tsup.config.ts`. Вызов асинхронный — гонки на шве закрываются e2e фичи: «пользователь успел раньше, чем кусок загрузился». Дальше e2e на SEA-бинаре и замер `bench:open`. Шов не должен срабатывать на старте, иначе кусок грузится на каждом запуске и выигрыша нет. Проверка — юнит «до первого обращения к фиче загрузчик не спрошен» (подставить счётчик через `setLazyModuleLoader`, пример — `extensionsWorkbenchService.test.ts`) и живой старт собранного `main.cjs` под `strace -f -e trace=openat`: без SEA кусок читается файлом `lazy/<id>.cjs`, и на старте его в трассе быть не должно. Для куска из нашего кода правило 1 другое — ниже.
- **Кусок из нашего кода** (роли процесса: extension host, file watcher) — запись `LAZY_CHUNKS` с `entry` (модуль-вход, `src/vs/diode/roles/*Role.ts`) и `sharedBudgetKb`; `id` — не пакет, а имя `roles/<роль>`. `main.ts` зовёт `loadLazyModule("roles/<роль>", () => import("./roles/<роль>Role.ts"))` в ветке роли: в dev и тестах работает `import()` модуля, а в сборке ядра плагин `lazyEntryChunksPlugin` (`tsup.config.ts`) делает его внешним `import("roles/<роль>")`, иначе esbuild без code-splitting вклеил бы роль в `main.cjs`. Кусок собирается тем же esbuild, но из пути входа, с `mainFields: module, main` (как ядро: иначе общий пакет в куске и в ядре — разные файлы, jsonc-parser UMD против ESM, и UMD падает в бандле), с `define` версии и другими кусками внешними (ext host грузит iconv своим `import()` через загрузчик). `import.meta.url` — тем же шимом, что у ядра (ниже «Ядро — CJS»): кусок исполняется не своим файлом, а `entryDir()` обязан дать каталог `main.cjs`, где вне SEA лежат ассеты и куски. Без этого ext host в self-extract не находил кусок iconv (e2e `roleChunks`, вариант self-extract).
  - **Общие модули дублируются.** `base/common`, протокол RPC, `vscodeTypes` нужны и ядру, и роли; запретить пересечение нельзя, а «модули, достижимые только из входа» без ручного объявления не отличить от законно общих. Поэтому правило 1 для такого куска: вход не лежит в `main.cjs` (иначе ядро тянет роль статически), а копия общих модулей — не больше `sharedBudgetKb` (метрика — `bytesInOutput` общих входов в куске; сводку «кусок N КБ, общих M КБ» печатает `lazy-chunks-check`). Бюджет ловит обе утечки — код роли, затянутый в ядро статическим импортом, и ядро, затянутое в роль, — и называет крупнейшие общие модули. Поднимать бюджет — осознанно, с причиной в PR: законно вырос общий модуль (`vscodeTypes` с поверхностью API), а не роль утекла в ядро. Типовая утечка — чистая функция в модуле роли, которую зовёт и редактор: выносить её в свой модуль (`passesThroughSymlink.ts` — так `SharedTreeWatcher` ушёл из `main.cjs`).
  - **Цена копии.** Лишний парс в процессе роли (кэш кода V8 его снимает) и **своё состояние уровня модуля** у каждой копии: обработчик `setUnexpectedErrorHandler`, загрузчик `setLazyModuleLoader`, кэши. Что `main.ts` ставит процессу до развилки, вход роли ставит заново в свою копию, — иначе `importLazyModule` внутри куска остался бы с прямым `import()`, а он в `vm.Script` падает `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` (ловит `e2e/roleChunks.test.ts`). Объекты через границу копий не ходят: роль получает управление вызовом функции без аргументов.
  - **Проверка** — юнит «каждый кусок исполняется без node_modules» (`scripts/build-lazy-chunks.test.mjs`: метаданные не видят `require` внутри UMD-фабрики), e2e роли на SEA, `strace -f -e trace=execve,openat` сессии из `node dist/main.cjs`: кусок роли открывает только процесс этой роли. Вход роли исполняется только в форке — исключён из покрытия и мутационного гейта, как `extensionHostSubprocess.ts`.
- **Ядро — CJS** (`dist/main.cjs`, `format: cjs` в `tsup.config.ts`; SEA — `mainFormat: "commonjs"`). Парс CJS-скрипта дешевле ESM-модуля, а V8-снапшот SEA принимает только CJS (шаг 6 OpenPerformance.md). Расширение `.cjs`: в репозитории `"type": "module"`, а у self-extract рядом нет `package.json` вовсе. Что из этого следует:
  - **Резолв пакетов — `mainFields: module, main`** (`MAIN_FIELDS` в `build-lazy-chunks.mjs`, общий у ядра и кусков из нашего кода), как резолвило ESM-ядро. Под CJS esbuild по умолчанию берёт `main`, а у jsonc-parser там UMD с `require` внутри фабрики — в бандл не вклеивается и падает в рантайме.
  - **`import.meta` в CJS пуст** — `import.meta.url` подменяет шим `scripts/import-meta-url-shim.mjs` (esbuild `inject` + `define`, `importMetaUrlShim()` в `build-lazy-chunks.mjs`), один на ядро и куски из нашего кода. Значение — URL главного скрипта процесса, `require.main.filename`: в SEA это бинарь (как и у прежнего ESM-ядра), иначе `main.cjs` — рядом с ним ассеты и куски. Не `__filename` (кусок исполняется как `diode:lazy/<id>.cjs`) и не `process.argv[1]` (в SEA это имя вызова, а run-as-node переписывает его на путь чужого скрипта). Значение — **геттер**, считается в момент вызова: константа уровня модуля запеклась бы в снапшот.
  - **Top-level await нет** — развилка ролей в `main.ts` живёт в `main()`, отказ которого бросается заново вне промиса (`process.nextTick`): стек в stderr и код 1, как у отказа top-level await ESM. Просто оставить промис без обработчика нельзя — его перехватила бы страховка `unhandledRejection` редактора.
  - Внешний `import("<id>")` кусков esbuild в CJS оставляет `import()` — запасной путь dev и правило гейта «только динамически» не изменились.
- **Кэш кода V8** — `lazy/<id>.v8cache` рядом с куском, только в SEA. Снимает `buildLazyChunkCodeCaches` при `build:sea` **после исполнения** куска и его `warmup` из `LAZY_CHUNKS`: V8 компилирует функции лениво и кладёт в кэш только скомпилированные, кэш одной компиляции почти пуст. Поэтому `vm.Script`, а не `compileFunction` (у неё кэш снимается только до вызова). На xterm: 36 → 11 мс на кусок с первым терминалом (замер — OpenPerformance.md). V8 принимает кэш, только если совпали версия, флаги **и read-only часть снапшота процесса**: бинарь стартует из V8-снапшота ([ниже](#верхний-уровень-модулей-и-v8-снапшот)), и кэш, снятый голым node, он отвергает. На node 26 кэш принимает только снапшот того же входа, собранный с `--predictable` (`SNAPSHOT_BUILD_FLAGS`; без флага кэш отвергается даже пересобранным снапшотом того же скрипта). Поэтому `build:sea` — два прохода: бинарь первого прохода сам снимает кэш в режиме run-as-node (`scripts/lazy-chunk-code-cache.cjs`), второй проход вшивает кэш в бинарь из того же `main.cjs`. Отказ (`cachedDataRejected`) загрузку не ломает и уходит в `onUnexpectedError` → лог: в SEA его быть не должно (e2e `terminalLazyStart`, `encodingLazy`, `sea-install` проверяют лог). Обёртка в сборке и загрузчике — байт в байт (юнит «кэш из сборки принят»). Новой части с горячим путём — `warmup` (функция без замыканий, уезжает в дочерний процесс исходником).
- **Шов внутри объекта, а не асинхронная фабрика** (xterm): если у фичи есть объект, который создают синхронно и сразу читают (`pid` сессии, вкладка терминала), кусок грузит сам объект, а до готовности копит то, что пришло (вывод PTY), и отдаёт пустое (сетка) — как `TerminalInstance` эталона с `_xtermReadyPromise`. Наружу — промис готовности (`xtermReady`), никогда не отклоняется.

## Common/Logging/
Логирование в стиле VS Code: один `ILogService` на процесс (`ILogServiceDIToken`), из него `ILogger` per channel (dotted, напр. `extensions.host`). Уровень канала резолвится walk-up по точкам → wildcard `*` → дефолт. Sinks (`ILogSink`) — fan-out fire-and-forget: `RingBufferSink` (источник для будущей Output-вкладки) и `FileSink` (append-only). В тестах биндится `NULL_LOG_SERVICE`. Человекочитаемое имя канала для селектора Output даёт его создатель — `createLogger(id, { label })` (аналог `ILoggerOptions.name` vscode); `ILogService.getRegisteredChannels()`/`onDidRegisterChannel` отдают такие каналы, и `OutputService` переносит их в реестр Output. Канал без метки появляется в селекторе под сырым id, когда в него впервые напишут.

Неочевидные гейты:
- **dev vs packaged:** `FileSink` (`./diode.log`) добавляется только когда `isPackagedRuntime() === false`; в упакованных сборках файлового sink нет. Гейт идёт именно по `isPackagedRuntime()` (`Assets/PackagedRuntime.ts`), а не по `isSeaBinary()`: self-extract — тоже прод, но `isSea()` там `false`, и по старому гейту прод писал бы `diode.log` в cwd пользователя.
- При `NULL_LOG_SERVICE` extension-host stdio остаётся `"inherit"` — семантика тестов не меняется.
- `isSeaBinary()` идёт через `seaRequire()("node:sea")` (`base/node/isSea.ts`): статический ESM-import `node:sea` **ломает SEA-сборку**. База `require` — `process.execPath`, а не `"file:///"`: тот на win32 бросал (`ERR_INVALID_FILE_URL_PATH`, у файлового URL нет буквы диска), и Windows-SEA считал себя не-SEA — ассеты искались файлами рядом с exe.
