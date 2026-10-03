# Файловый сервис (`IFileService`) вместо прямого `node:fs` в UI-слоях — исследование

Статус: **исследование, к работе не взято.** Документ отвечает на вопрос «нужен ли
нам аналог `IFileService` / `IFileSystemProvider`, какой минимальной формы, во что
обойдётся переезд и в каком порядке его делать». Продовый код не менялся.

База исследования — `21af680b` (main на 03.10.2026). Эталон — vscode `90da900`
(26.09.2026). Все счётчики ниже — production-файлы `src/vs` без `*.test.ts`,
`*.bench.ts` и тест-утилит.

Соседние исследования той же группы: [Events](Events.md) (Emitter/Event),
[Lifecycle](Lifecycle.md) (Disposable). На стыках — только ссылки, см. раздел 11.

---

## 1. Короткий ответ

- **Сервис нужен, и половина его уже есть.** `IFileSystemProviderRegistry` — это
  `IFileService`, урезанный до `readFile`. Схема `file` в нём уже
  зарегистрирована (`DiskFileSystemProvider`, 27 строк, только чтение). Дешевле
  **дорастить реестр до сервиса**, чем заводить второй механизм рядом.
- **Прямой `node:fs` в UI-окружениях — это 13 файлов и 26 синхронных вызовов**
  (7 browser-файлов / 19 вызовов, 2 common-файла ядра / 7 вызовов, плюс 3
  common-файла extension host'а на `fs/promises` и 1 файл учебной песочницы).
  Это немного. Из 26 вызовов **настоящий горячий путь — 7**: загрузка/запись
  `TextFileModel` (5) и чтение каталога в Explorer (2).
- **Дорогая часть одна — асинхронное открытие файла.** Всё остальное уже стоит
  в асинхронном контексте (команды, валидаторы ввода, `getChildren` дерева,
  undo-элементы — все четыре контракта принимают `Promise`). А вот открытие
  `file:` синхронно насквозь, и на это завязаны **~570 вызовов
  `openFile`/`openUri` без `await` в 102 тестовых файлах**. Переделка прод-кода
  здесь средняя (асинхронный путь для недисковых схем уже существует —
  `openVirtualUri`), цена — в тестах и в гонках.
- **Горячий путь сервис не замедлит.** Чтение+декод+документ на `small` — 3 мс из
  321 мс старта; слой сервиса добавляет один оборот event loop'а и убирает два
  лишних syscalls (`existsSync` + отдельный `statSync`). Для больших файлов узкое
  место — жадные O(N)-проходы и полная загрузка в строку, а не способ чтения
  ([OpenPerformance](OpenPerformance.md)). Зато сервис даёт **шов**, в который
  потом встаёт стриминг, — сейчас его вставлять некуда.
- **`EXCEPTIONS` сервис почти не трогает.** Из шести записей browser→node он
  снимает **одну** (`contrib/files/browser → contrib/bulkEdit/node`). Три записи
  про `services/search/node` и две про `terminalEnvironment/node` — это не
  «доступ к диску», а «токен и класс лежат в node-каталоге»; они снимаются
  выносом интерфейса в common и к файловому сервису отношения не имеют.
- **Гейт слеп именно в этом месте** — проверяет только относительные импорты.
  Храповик на `node:*` в common/browser стоит один маленький PR и его надо
  ставить **первым**, до любой миграции: он останавливает рост долга.

Рекомендация: **гейт — сейчас; сервис + холодные потребители + Explorer + запись —
брать по готовности (4 средних PR); асинхронную загрузку модели — отдельным
решением, совместив с этапом 4 [OpenPerformance](OpenPerformance.md)** (стриминг
всё равно потребует её же). Порядок и риски — раздел 8.

---

## 2. Инвентаризация обращений к диску

### 2.1. Сверка с исходными счётчиками аудита

| Что считали | Было в аудите | Перепроверка | Комментарий |
|---|---|---|---|
| файлов browser-окружения с `node:fs` | 7 | **7** | сходится |
| файлов common-окружения с `node:fs` | 6 | **6** | сходится; из них 3 — extension host (`fs/promises`), 1 — песочница `textMate/common/learning` (гейтом исключена) |
| sync-вызовов в `workbench/contrib` | 28 | **30** | 16 browser + 14 node (`bulkEdit/node` 9, `terminal/node/loadNodePty` 5) |
| sync-вызовов в `workbench/services` | 14 | **18** | 1 browser + 5 common + 12 node (`loadRipgrep` 5, `extensionSecretsStore` 4, `loadTsServer` 2, `extensionStoragePaths` 1) |
| sync-вызовов в `workbench/browser` | 2 | **2** | сходится |
| `fileActions.ts` | 7 | **8** | 7 строк, в `:152` два вызова |
| `textFileModel.ts` | 4 | **5** | 4 строки, в `:562` `existsSync` + `readFileSync` |

Расхождения — счёт строк против счёта вызовов; картина та же.

Всего по `src/vs`: **37 файлов** импортируют `node:fs`/`node:fs/promises`
(7 browser, 6 common, 22 node, 2 `diode`), синхронных вызовов — **95**, из них
в UI-окружениях (browser + common) — **26**.

Не нашлось в аудите:

- **`chokidar` импортируется из browser-окружения** —
  `contrib/files/browser/fileTreeDataProvider.ts:6`. Explorer держит собственные
  пер-каталожные watcher'ы мимо `IFileWatcher`/`ITreeFileWatcher` — третий
  механизм слежения. Гейт npm-импорты не смотрит вовсе.
- **`DiskFileSystemProvider` уже существует** (`platform/files/node/`), и схема
  `file` в реестре зарегистрирована — в `diode/modules/markersModule.ts:39`.
  `docs/ARCHITECTURE.md` («Недисковые ресурсы») утверждает обратное.
- Кроме `node:fs`, из common/browser тянутся `node:path` (**24 файла**),
  `node:crypto` (2: `platform/workspace/common/workspaceId.ts`,
  `api/common/vscodeNamespace.ts`), `node:os` (1: `fileOperationsService.ts`),
  `node:url` (1, песочница). Это вопрос гейта (раздел 9), не файлового сервиса.

### 2.2. UI-окружения (browser/common), процесс редактора — цель миграции

| Файл | Вызовы | Sync | Путь | Что делает |
|---|---|---|---|---|
| `services/textfile/common/textFileModel.ts` | `existsSync`+`readFileSync` `:562`, `writeFileSync` `:594` `:748`, `statSync` `:761` | 5 | **горячий** | загрузка (open/revert/reopen with encoding), save, saveAs, stat до и после записи и на каждый сигнал watcher'а |
| `contrib/files/browser/fileTreeDataProvider.ts` | `readdirSync` `:145`, `statSync` `:160` (на каждый симлинк) | 2 | **горячий** | раскрытие каталога, корень на старте, каждое обновление по watcher'у |
| `browser/workbenchStateService.ts` | `existsSync` `:189` × число вкладок | 1 | старт | фильтр восстановимых вкладок на ресторе сессии |
| `services/history/browser/historyService.ts` | `existsSync` `:360` | 1 | тёплый | `isReachable` на каждую запись истории при Back/Forward |
| `contrib/files/browser/fileActions.ts` | `existsSync`/`statSync` `:48-49` `:75-76` `:151-152` `:177` | 8 | тёплый | валидаторы Open File / Open Folder / Save As — **на каждое нажатие** в поле ввода |
| `contrib/files/browser/fileOperationsService.ts` | `statSync` `:223`, `existsSync` `:242` `:281` | 3 | тёплый | New File/Folder, Rename: цель + валидаторы на каждое нажатие |
| `contrib/preferences/browser/preferencesActions.ts` | `existsSync`, `mkdirSync`, `writeFileSync` `:35-38` | 3 | холодный | посев `settings.json`/`keybindings.json` |
| `browser/actions/encodingActions.ts` | `existsSync` `:29` | 1 | холодный | доступен ли Reopen with Encoding |
| `base/common/assets/bundleFile.ts` | `existsSync` `:23`, `readFileSync` `:44` | 2 | bootstrap | чтение бандла ассетов; оба импортёра — из `base/node/assets` |

Итого: **9 файлов, 26 sync-вызовов.**

### 2.3. Node-окружение, но зовётся из browser (за `EXCEPTIONS`)

| Файл | Вызовы | Путь | Комментарий |
|---|---|---|---|
| `contrib/bulkEdit/node/workspaceEditService.ts` | 9 sync (`rmSync`, `mkdirSync`, `writeFileSync`, `existsSync`) | тёплый, **бывает долгим** | исполняет create/delete/rename/copy из Explorer с undo; импортируется из `contrib/files/browser` (запись `EXCEPTIONS`) |
| `platform/files/node/fileClipboardFs.ts` | 6 sync (`cpSync` рекурсивный, `renameSync`, `rmSync`, `existsSync`) | **бывает долгим** | копирование каталога целиком блокирует кадр на всё время копии |
| `platform/files/node/trashService.ts` | 5 sync | холодный | XDG-корзина и восстановление из неё |
| `services/search/node/fileSearchService.ts` | 1 async (`fs.promises.readdir`, чанкованный обход) | фон | индекс Quick Open; UI не блокирует |

### 2.4. Node-окружение, процесс редактора — остаётся как есть

| Файл | Sync / async | Почему не трогаем |
|---|---|---|
| `platform/state/node/stateService.ts` | 3 sync + 2 async | чтение на bootstrap до первого кадра и flush на выходе — sync здесь **нужен** (раздел 7.4) |
| `platform/configuration/node/configurationService.ts` | 4 async | уже async, уже за интерфейсом в common |
| `platform/keybinding/node/keybindingsService.ts`, `services/keybinding/node/keybindingsEditorService.ts` | 1 + 3 async | то же |
| `platform/extensionManagement/node/*` | 15 sync + 2 async | установка расширений; отдельная подсистема, блокировку на распаковке вести там |
| `base/node/assets/*`, `diode/main.ts`, `diode/startupTrace.ts`, `platform/log/node/fileSink.ts` | 14 sync + 4 async | bootstrap и лог |
| `loadRipgrep`, `loadNodePty`, `loadTsServer`, `extensionSecretsStore`, `extensionStoragePaths`, `workspaceContainsActivation` | 12 sync + 2 async | одноразовые загрузчики и хранилища extension-сервисов |

### 2.5. Extension host (отдельный процесс)

| Файл | Вызовы | Комментарий |
|---|---|---|
| `api/common/fileSystemNamespace.ts` | 13 async (`fs/promises`) | `vscode.workspace.fs` для схемы `file` — прямо на диск из субпроцесса |
| `api/common/workspaceNamespace.ts` | 1 async `:483` | `openTextDocument` по промаху реестра |
| `api/common/findFiles.ts` | 1 async `:156` | обход для `workspace.findFiles` |

UI-поток они не блокируют: это другой процесс. Нарушение здесь только
раскладочное — `node:fs` в каталоге `common`.

### 2.6. Пути к диску, которые сейчас никак не связаны

| Путь | Чем читает | Чем пишет | Чем следит |
|---|---|---|---|
| Редактор (`TextFileModel`) | `readFileSync` | `writeFileSync` на месте | `IFileWatcher` |
| Explorer | `readdirSync` | `WorkspaceEditService` → `fileClipboardFs`/`TrashService` | свой `chokidar` |
| Дифф, quick diff, references, compare | `IFileSystemProviderRegistry.readFile` (4 потребителя) | — | `onDidChangeFile` реестра |
| Поиск / Quick Open | `fs.promises.readdir`, ripgrep-субпроцесс | — | — |
| `workspace.fs` расширений | `fs/promises` в субпроцессе | там же | `ITreeFileWatcher` через host |
| Настройки, state, keybindings | свои node-сервисы | они же | `IFileWatcher` |

Следствие, ради которого всё затевается: **никто в процессе не знает, что файл
изменили мы сами**. Explorer узнаёт о собственном New File от watcher'а с
дебаунсом 300 мс; открытая модель узнаёт о Rename/Delete из Explorer только
потому, что команды руками зовут `EditorService`. У vscode это одно событие
`IFileService.onDidRunOperation`.

---

## 3. Как это сделано в vscode

| Часть | Файл (строк) | Суть |
|---|---|---|
| Контракты | `platform/files/common/files.ts` (1658) | `IFileService` (38 членов), `IFileSystemProvider`, 14 capabilities, `FileOperationError`/`FileOperationResult`, `etag()` |
| Сервис | `platform/files/common/fileService.ts` (1509) | роутер схема → провайдер; `resolve` (stat + дети), `readFile`/`readFileStream`, `writeFile` с dirty-write-гардом, `move`/`copy`/`del` с `can*`-парами, пер-ресурсная очередь записи (`ResourceQueue`), события |
| Диск | `platform/files/node/diskFileSystemProvider.ts` (925) | `fs.promises`, open/read/write/close, атомарная запись (temp-сосед + `rename`), атомарное удаление, блокировки по ресурсу, корзина, clone |
| Модель | `workbench/services/textfile/common/textFileEditorModel.ts` (1217) | `async resolve()` (из буфера / из backup / с диска), `lastResolvedFileStat`, save через `TaskSequentializer`, режимы conflict/error/orphaned |

Что из этого несущее, а что — следствие устройства vscode:

- **Несущее.** (1) Один роутер по схеме: потребитель не знает, диск это или
  расширение. (2) `stat` приезжает вместе с содержимым — `readFile` возвращает
  `{ value, mtime, size, etag }`. (3) Защита от грязной записи: `writeFile`
  получает `mtime`+`etag` последнего чтения и бросает `FILE_MODIFIED_SINCE`.
  `etag` — просто `mtime.toString(29) + size.toString(31)`, **ровно наша пара
  `IDiskStat { mtimeMs, size }`**. (4) `onDidRunOperation` — «это сделали мы».
  (5) Вся модель открытия асинхронна: `resolve()` возвращает `Promise`.
- **Следствие многопроцессности, нам не нужно.** `VSBuffer` и потоки
  `VSBufferReadableStream` (сериализация через IPC), buffered-чтение через
  `open/read/close` (чанки через RPC), correlated watchers, `activateProvider`
  (ленивая активация расширения по схеме), `canHandleResource`.
- **Нюанс, который снимает один из вопросов.** Extension host у vscode ходит на
  диск **напрямую, без RPC**: `api/node/extHostDiskFileSystemProvider.ts`
  регистрирует тот же `DiskFileSystemProvider` в субпроцессе — «so that certain
  file operations can execute fast within the extension host without
  roundtripping». То есть наш `fileSystemNamespace.ts` повторяет эталон по
  поведению; отличие только в том, что у vscode привязка к диску лежит в
  `api/node`, а в `api/common` — роутер.

---

## 4. Варианты

### A. Ничего не менять, только гейт

Поставить храповик на `node:*` в common/browser со списком из 12 текущих файлов.

- Цена: 1 маленький PR.
- Даёт: долг перестаёт расти.
- Не даёт: sync-IO в UI-потоке остаётся; стримингу некуда встать; каждый новый
  провайдер схемы по-прежнему read-only; тесты по-прежнему ходят на реальный
  диск.

### B. Синхронный фасад (`IFileService` с `statSync`/`readFileSync`)

Тот же шов, но методы синхронные — потребители переезжают заменой
`fs.x` → `files.x`, открытие остаётся синхронным, тесты не трогаем.

- Цена: 2–3 средних PR, почти механика.
- Даёт: чистые слои, in-memory провайдер для тестов, одно место для атомарной
  записи.
- Не даёт: UI-поток по-прежнему блокируется; **провайдеры расширений
  синхронными быть не могут** (они за границей процесса) — значит, роутер по
  схеме получится только для диска, а единый интерфейс «диск или расширение»
  развалится на два. Стриминг в синхронный контракт не помещается.
- Вердикт: чинит раскладку, не чинит архитектуру. Через полгода переделывать.

### C. Асинхронный сервис, как в vscode, целиком одним заходом

- Цена: большой PR или серия с долгоживущей веткой; ~570 тестовых вызовов
  правятся разом.
- Риск: всё одновременно — сервис, Explorer, запись, асинхронное открытие,
  гонки. На слабой машине и с известными флаками — плохая идея.

### D. Асинхронный сервис, миграция по потребителям (рекомендуется)

Сервис сразу асинхронный и сразу финальной формы, но потребители переезжают
по одному, от дешёвых к дорогим. Асинхронная загрузка модели — последним и
отдельным решением.

- Цена: гейт (S) + 4 средних PR + 1 большой (загрузка модели), раздел 8.
- Даёт: каждый PR самоценен и уменьшает список исключений гейта; самый дорогой
  шаг можно отложить, не блокируя остальное.
- Цена компромисса: пока загрузка не переехала, `TextFileModel` остаётся в
  списке исключений гейта, а чтение — единственным синхронным путём.

---

## 5. Минимальный сервис

### 5.1. Где живёт

```
platform/files/common/
  files.ts                      — IFileService, IFileSystemProvider, IFileStat, FileType,
                                  FileSystemProviderCapabilities, FileOperationError, etag()
  iFileServiceDIToken.ts        — токен
  fileService.ts                — роутер по схеме, dirty-write-гард, очередь записи, события
  inMemoryFileSystemProvider.ts — для тестов и будущего untitled:
platform/files/node/
  diskFileSystemProvider.ts     — существующий файл, доращивается до полного провайдера
```

Имена файлов и типов — как у vscode: это облегчает сверку с эталоном (роль
офиса «сверка») и не требует изобретать словарь.

### 5.2. Поверхность

```ts
interface IFileService {
    // провайдеры — то, что сейчас IFileSystemProviderRegistry
    registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable;
    hasProvider(resource: Uri): boolean;
    hasCapability(resource: Uri, capability: FileSystemProviderCapabilities): boolean;
    onDidChangeFileSystemProviderRegistrations(cb): IDisposable;

    // чтение
    stat(resource: Uri): Promise<IFileStat>;                 // type, mtime, size, etag
    exists(resource: Uri): Promise<boolean>;
    resolve(resource: Uri): Promise<IFileStatWithChildren>;  // readdir + тип цели симлинка
    readFile(resource: Uri, options?: { etag?: string }): Promise<IFileContent>; // value + stat

    // запись
    writeFile(resource: Uri, value: Uint8Array, options?: IWriteFileOptions): Promise<IFileStat>;
    createFolder(resource: Uri): Promise<void>;              // mkdir -p
    del(resource: Uri, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void>;
    move(source: Uri, target: Uri, overwrite?: boolean): Promise<void>;
    copy(source: Uri, target: Uri, overwrite?: boolean): Promise<void>;

    // события
    onDidRunOperation(cb: (e: IFileOperationEvent) => void): IDisposable; // «это сделали мы»
    onDidFilesChange(cb: (uris: readonly Uri[]) => void): IDisposable;    // «изменилось снаружи»
}

interface IWriteFileOptions {
    mtime?: number; etag?: string;   // гард: бросить FILE_MODIFIED_SINCE, если диск ушёл вперёд
    atomic?: boolean;                // temp-сосед + rename
    create?: boolean; overwrite?: boolean;
}
```

16 членов против 38 у эталона. Формы событий (`Event<T>` против колбэка) —
по итогам [Events](Events.md); в наброске оставлен текущий стиль реестра.

### 5.3. Решения по спорным пунктам

| Вопрос | Решение | Почему |
|---|---|---|
| **Capabilities** | да, но 4 из 14: `Readonly`, `Trash`, `FileAtomicWrite`, `FileReadStream` | без `Readonly` роутер не отличит провайдера расширения (сейчас все read-only) от диска, а `vscode.workspace.fs.isWritableFileSystem` отвечать нечем; `Trash` — корзина есть только у диска и только на Linux/macOS; `FileReadStream` — зарезервированный слот под этап 4 OpenPerformance, реализацию не пишем |
| **etag** | да, в форме эталона (`mtime`+`size`) | это уже наш `IDiskStat`; гард переезжает из `TextFileModel.hasExternalChange` в `writeFile` и перестаёт быть гонкой «stat → write» в двух разных вызовах |
| **Атомарная запись** | да, опцией; для save модели — включена по умолчанию | сейчас `writeFileSync` на месте: падение посреди записи оставляет обрезанный файл. Исключения по эталону: симлинк (rename заменил бы ссылку файлом) и файл с жёсткими ссылками/чужим владельцем — там честный откат на запись на месте |
| **Очередь записи по ресурсу** | да | два save подряд (автосохранение + ручной) не должны переплестись; у vscode это `ResourceQueue`, у нас хватит `Map<string, Promise>` |
| **Потоковое чтение** | слот в capabilities и `IFileContent`, без реализации | сам по себе стриминг бесполезен, пока `TextDocument` строится из одной строки ([PieceTree](PieceTree.md)); но шов надо спроектировать так, чтобы он встал без смены интерфейса |
| **`VSBuffer`** | нет, `Uint8Array` | обёртка нужна ради IPC и браузера; у нас один процесс и Node `Buffer` уже `Uint8Array` — возвращаем без копии |
| **Sync-методы** | нет | вариант B, отвергнут |
| **`can*`-пары, clone, realpath, unlock, блокировки** | нет | потребителей нет |
| **Ошибки** | `FileOperationError` + `FileOperationResult` (`NOT_FOUND`, `IS_DIRECTORY`, `MODIFIED_SINCE`, `PERMISSION_DENIED`, `EXISTS`, `TOO_LARGE`) | маппинг `ENOENT`→код уже написан в `fileSystemNamespace.toFileSystemError` для extension host'а — общий словарь |

---

## 6. Отношение к реестру и к watcher'ам

### 6.1. Сервис поглощает реестр

`IFileSystemProviderRegistry` = `registerProvider` + `hasProvider` + `readFile` +
два события. Это строгое подмножество `IFileService`. Держать оба — значит
иметь два роутера по схеме, которые надо синхронизировать.

- `IFileSystemProviderRegistry` и `IReadOnlyFileSystemProvider` **удаляются**,
  потребители (их 4: `openDiffPair`, `compareActions`, `quickDiffService`,
  `referencesService`) и `api/browser/fileSystemProviderAdapter.ts` переходят на
  `IFileService`. Объём — единицы строк на потребителя.
- **Схема `file` — обычный провайдер.** Регистрация переезжает из
  `markersModule.ts` в модуль ядра (диск не имеет отношения к маркерам).
- **Провайдеры расширений** регистрируются как сейчас, с capability `Readonly`.
  Запись через провайдера расширения в UI-процессе **не делаем**, пока нет
  потребителя: в `vscode.d.ts` члены `FileSystemProvider` на запись не
  раскомментированы, а единственный, кому она нужна (`workspace.fs.writeFile` на
  чужую схему), работает внутри субпроцесса и сервис редактора не трогает. Но
  интерфейс `IFileSystemProvider` уже содержит `writeFile` — когда потребитель
  появится, это снятие флага `Readonly` и проброс через мост, а не новый
  контракт.
- `untitled:`-провайдер из [Uri](Uri.md) (шаг 3 из #107) становится
  `InMemoryFileSystemProvider`, зарегистрированным на схему, — тот же класс, что
  нужен тестам.

### 6.2. Watcher'ы не переделываем, а подключаем

`IFileWatcher` и `ITreeFileWatcher` остаются примитивами в текущем виде —
у них отлаженная граница процесса, коалесинг и общий обход. Стыковка:

- **Этап 1 (вместе с сервисом): никакой.** Сервис отдаёт только
  `onDidRunOperation`. Этого уже хватает Explorer'у, чтобы обновляться на
  собственные операции мгновенно.
- **Этап 2 (вместе с Explorer): Explorer уходит со своего `chokidar`** на
  `ITreeFileWatcher` с `recursive: false` — тот это уже умеет
  (`ITreeFileWatchOptions.recursive`). Третий механизм слежения исчезает,
  watcher'ы каталогов Explorer'а начинают делить обход с git'ом и LSP через
  `SharedTreeWatcher`.
- **Этап 3 (вместе с моделью): `onDidFilesChange`.** `DiskFileSystemProvider.watch`
  — тонкая обёртка над `IFileWatcher`/`ITreeFileWatcher`; сервис агрегирует
  события провайдеров (диск + `onDidChangeFile` расширений — эта агрегация в
  реестре уже написана). Модель подписывается на сервис, а не получает
  `fileWatcher` полем. До этого этапа поле остаётся.

Единого `watch()` на `IFileService` с корреляциями, как у эталона, **не делаем**:
это ответ на проблему «сто расширений в сотне процессов», которой у нас нет.

---

## 7. Цена async

### 7.1. Что уже асинхронно и ничего не стоит

| Контракт | Где | Статус |
|---|---|---|
| `EditorService.openUri` | `editorService.ts:1109` | уже возвращает `Promise<void>`, уже «никогда не отклоняется» |
| Открытие недисковой схемы | `openVirtualUri` `:1182` | уже «сходить за содержимым → синхронно вставить вкладку» — ровно нужная форма |
| `validateInput` в QuickInput | `quickInputService.ts:41` | принимает `Promise` |
| `ITreeDataProvider.getChildren` | `@tuidom/elements` | принимает `T[] \| Promise<T[]>` — **в tuidom ничего делать не надо** |
| `IUndoRedoElement.undo/redo` | `iUndoRedoElement.ts:19` | `void \| Promise<void>` |
| `TextFileModel.save/saveAs` | `:579`, `:741` | уже `async`; в тестах 43 из 71 вызова с `await` |
| Команды | `CommandRegistry` | обработчики асинхронные |

Поэтому разделы 2.2 (кроме модели и истории) и 2.3 переезжают без смены
контрактов.

### 7.2. Что ломается при асинхронной загрузке модели

Синхронная цепочка сейчас:
`openFile(path)` → `openUri` → `openResolvedUri` → `modelRegistry.acquire(uri)` →
фабрика `createFileModel` → `model.openFile` → `readFileSync`.

| Место | Что меняется | Цена |
|---|---|---|
| `TextFileModelRegistry.acquire` | появляется `resolve(uri): Promise<ref>` (грузит), `acquire` остаётся для уже загруженных; **дедуп по незавершённой загрузке** — второй `resolve` того же uri ждёт тот же промис | S |
| `EditorService.openUri` | ветка `file:` сливается с `openVirtualUri`: `await` модели → синхронная вставка вкладки. Ошибка чтения уходит в `reportOpenFailed`, как у недисковых схем | S–M |
| `EditorService.openFile(path)` | остаётся `void`, но вкладка появляется не в том же тике | контракт |
| **Вызовы «открыл → сразу работаю с активным редактором»** | в проде их 2: `referencesComponent.ts:275-276`, `searchComponent.ts:695-696` (`openUri` → `getActiveEditor()` без `await`); третий такой же, `problemsComponent.ts:155`, уже с `await` | S |
| `WorkbenchStateService.restoreOpenEditors` `:107` | синхронный цикл по группам и файлам + `activateTab` сразу после. Становится `async`; порядок вкладок обязан сохраниться → последовательный `await` или вставка по индексу. Флаг `restoring` должен пережить `await` | M |
| `main.ts:524` — файлы из CLI | `for … workbench.openFile(…)` → последовательно с `await`, первый кадр не ждёт остальных | S |
| `revertToDisk()`, `reopenWithEncoding()` | возвращают `boolean` синхронно → `Promise<boolean>`; автоперечитка по watcher'у (`handleExternalFileChange`) становится асинхронной — нужна защита от «буфер успели испачкать, пока читали» (эталон проверяет версию после чтения) | M |
| `HistoryService.isReachable` | синхронный `existsSync` внутри синхронного прореживания. Вариант эталона: не проверять заранее, а выбрасывать запись по неудаче открытия (`onOpenFailed`) | S–M |
| `diffEditorPane2.ts:206`, `acquireFileModel` | file-сторона диффа берёт модель синхронно | S |
| **Тесты** | **597 вызовов `openFile`/`openUri` в 102 файлах, с `await` — 25.** Остальные ~570 рассчитывают, что вкладка есть в следующей строке | **L** |

Новые классы гонок, которых сейчас нет по построению:

1. Два открытия одного файла подряд (двойной клик) — дедуп в реестре.
2. Открыли A, пока грузится — открыли B: кто активен в конце? Правило эталона —
   победил последний запрошенный; нужен счётчик запросов на группу.
3. Вкладку/группу закрыли, пока шла загрузка — результат выбросить, ссылку на
   модель освободить.
4. Save во время перечитки и перечитка во время save — та же
   последовательная очередь, что у эталона (`saveSequentializer`).

### 7.3. Как удешевить тесты

- **Не переписывать 570 мест руками.** Большинство идёт через харнесс
  (`TestUtils`, 3 точки входа) и `it(async …)`; замена на `await` — codemod.
  Синхронные `it` (они есть в 63 из 102 файлов) правятся вручную.
- **In-memory провайдер.** Тесты, которым диск не нужен по смыслу, получают
  `InMemoryFileSystemProvider` вместо `TempWorkspace`. Это заодно ответ на
  [TestRunTime](TestRunTime.md) и на слабую машину: меньше `mkdtemp`, меньше
  реального IO. Не цель этой задачи — побочная выгода, брать точечно.
- **Не держать два API дольше одного PR.** Параллельные `openFile` и
  `openFileSync` расползаются; допустимо только как внутренний шаг серии.

### 7.4. Где sync остаётся навсегда

| Место | Почему |
|---|---|
| `main.ts`, `base/node/assets/*`, `startupTrace.ts` | bootstrap до DI и до первого кадра; сервисов ещё нет |
| `StateService` — чтение при создании | состояние нужно синхронно до построения воркбенча |
| `StateService.writeStoreSync` | flush на выходе: после `process.exit` промисы не доживают |
| `fileSink.ts` | лог обязан пережить падение |
| загрузчики нативных модулей (`loadRipgrep`, `loadNodePty`, `loadTsServer`) | одноразовые проверки существования |

Всё это node-окружение, гейту не мешает.

---

## 8. Кто переезжает и в каком порядке

| # | PR | Размер | Что переезжает | Снимает с гейта | Риск |
|---|---|---|---|---|---|
| 0 | **Гейт-храповик** (раздел 9) | S | ничего; список исключений = текущее состояние | — | нет |
| 1 | **Сервис** | M | `files.ts`, `fileService.ts`, полный `DiskFileSystemProvider`, `InMemoryFileSystemProvider`; реестр поглощён, 4 потребителя + адаптер переведены; правка `ARCHITECTURE.md` | — | низкий: поведение не меняется |
| 2 | **Холодные потребители** | S–M | `fileActions`, валидаторы `fileOperationsService`, `preferencesActions`, `encodingActions`, фильтр рестора в `workbenchStateService`, `historyService.isReachable` | 6 из 7 browser-файлов | история: смена «проверить заранее» на «выбросить по неудаче» — видимое поведение |
| 3 | **Explorer** | M–L | `fileTreeDataProvider` (async `getChildren`, уход с `chokidar` на `ITreeFileWatcher`), `WorkspaceEditService` поверх `IFileService` → переезжает в `contrib/bulkEdit/browser`; `fileClipboardFs` → `copy`/`move` сервиса | последний browser-файл; **запись `EXCEPTIONS` `contrib/files/browser → contrib/bulkEdit/node`**; `chokidar` из browser | корзина: undo удаления = восстановление из корзины, в `IFileService` этого нет → нужен `ITrashService` в common (у эталона undo удаления в корзину нет вовсе); мерцание дерева на async-раскрытии |
| 4 | **Запись модели** | M | `save`/`saveAs` через `writeFile` с etag-гардом и атомарностью; очередь записи | — (импорт `node:fs` ещё нужен чтению) | контракт «без участников запись синхронна в текущем тике» (`textFileModel.ts:588`) исчезает — 28 тестовых `save()` без `await`; атомарная запись меняет inode → проверить реакцию собственного `IFileWatcher` и чужих watcher'ов |
| 5 | **Загрузка модели** | **L** | `TextFileModel.resolve()`, `registry.resolve`, слияние с `openVirtualUri`, рестор, CLI, ~570 тестовых вызовов; слежение через `onDidFilesChange` | `textFileModel.ts` — последний файл ядра | гонки из 7.2; флаки в e2e; делать **вместе с этапом 4 OpenPerformance** |
| 6 | **Хвосты раскладки** | S | `bundleFile.ts` → `base/node/assets`; привязка `workspace.fs` к диску → `api/node` (переиспользует `DiskFileSystemProvider`, как эталон), `findFiles`/`openTextDocument` — через тот же шов | 4 common-файла | низкий; RPC не появляется |

PR 0 независим и идёт первым. PR 2, 3, 4 зависят только от PR 1 и между собой
не связаны. PR 5 зависит от 4. PR 6 независим от 2–5.

### Что реально снимает записи `EXCEPTIONS`

| Запись | Снимается файловым сервисом? | Чем снимается |
|---|---|---|
| `contrib/files/browser → contrib/bulkEdit/node` | **да**, PR 3 | `WorkspaceEditService` перестаёт нуждаться в node |
| `workbench/browser → services/search/node` | нет | интерфейс `IFileSearchService` + токен в common; обход остаётся сырым `fs` в node (у эталона поиск тоже мимо `IFileService`) |
| `contrib/quickaccess/browser → services/search/node` | нет | то же + константа `BASENAME_BONUS` в common |
| `contrib/diff/browser → services/search/node` | нет | то же |
| `workbench/browser → services/terminalEnvironment/node` | нет | не про файлы; интерфейс + токен в common |
| `services/keybinding/browser → services/terminalEnvironment/node` | нет | то же |

Пять записей из шести — это «токен лежит рядом с node-реализацией», а не
отсутствие файлового сервиса. Их вынос — дешёвая самостоятельная задача в
[VscodeStructureFollowUps](VscodeStructureFollowUps.md); формулировку пункта
«у vscode тут RPC-фасады (`IFileService` и т.п.)» там стоит уточнить.

### Кто не переезжает

`platform/state`, `platform/configuration/node`, `platform/keybinding/node`,
`extensionManagement`, поиск, логгер, bootstrap. Они в node-окружении законно,
за интерфейсами в common, UI-поток дольше кадра не держат. У эталона
конфигурация читается через `IFileService` ради remote и web — у нас такой
нужды нет. Единственное, что стоит взять позже без переезда, — атомарную запись
`settings.json`/`state.json` тем же помощником.

---

## 9. Гейт

Предложение (без реализации): расширить `scripts/check-layers.mjs`, а не
заводить отдельное ESLint-правило — там уже есть определение окружения по пути
(`envOf`), список `EXCEPTIONS` с обоснованиями и исключение тестов/песочницы.

1. **Правило.** Файл окружения `common` или `browser` не импортирует `node:*` и
   голые имена встроенных модулей (`fs`, `child_process`, …) — ни value-, ни
   type-импортом (тип `fs.Dirent` в сигнатуре так же привязывает к Node).
2. **Node-only npm-пакеты** — короткий явный список (`chokidar`, `node-pty`,
   `yauzl`), запрещённый там же. Сейчас нарушитель один: `fileTreeDataProvider`.
3. **`node:path` — разрешён отдельной строкой**, а не исключениями: 24 файла,
   чистые строковые функции, долга «доступ к ОС» не создаёт. Замена на
   `base/common/path` — отдельный вопрос (раздел 12).
4. **Список исключений — пофайловый, с причиной и номером PR, который запись
   снимает.** Стартовое состояние:

   | Модуль | Файлов | Снимает |
   |---|---|---|
   | `node:fs` | 7 browser + 5 common (песочница `learning` исключена и так) | PR 2–6 |
   | `node:os` | 1 (`fileOperationsService.ts`) | PR 3 |
   | `node:crypto` | 2 (`workspaceId.ts`, `vscodeNamespace.ts`) | вне этой задачи |
   | `chokidar` | 1 | PR 3 |

5. **Храповик, а не порог:** гейт падает и на новый импорт вне списка, и на
   запись списка, которой больше нет в коде (иначе список не убывает).
6. Цель по `node:fs` — пустой список после PR 6.

---

## 10. Бенчи открытия и большие файлы

Вопрос: не замедлит ли слой сервиса горячий путь.

- **Малые файлы.** По лестнице старта ([OpenPerformance](OpenPerformance.md))
  чтение+декод+документ на `small` — 3 мс из 321. Сейчас это `existsSync` +
  `readFileSync` + `statSync` — три обращения к ФС по пути. Сервис делает
  `open` → `fstat` → `read` и отдаёт stat вместе с содержимым: обращений не
  больше, плюс один оборот event loop'а. Ожидание — в пределах шума; проверка —
  существующими вехами `textfile:read/decoded/document-built`, ничего нового
  мерить не надо.
- **Рестор N вкладок.** Сейчас N синхронных чтений подряд до первого кадра.
  С асинхронной загрузкой активная вкладка читается первой, остальные — после
  кадра (или лениво, по активации — как у эталона). Это единственное место, где
  сервис **ускоряет** наблюдаемый старт.
- **Средние файлы (13 МБ — 3 с).** Время — в жадных O(N)-проходах после чтения;
  способ чтения на результат не влияет.
- **Гигантские файлы (`log500m` — 88 с).** Этап 4 OpenPerformance — стриминг
  чанками и инкрементальный декодер. Сейчас ему некуда встать: чтение зашито в
  `loadDocumentFromDisk` одной строкой. С сервисом это `readFileStream` у
  провайдера с capability `FileReadStream` и другой конструктор документа — без
  смены контракта модели, потому что `resolve()` уже асинхронный. **Отсюда
  рекомендация делать PR 5 вместе с этапом 4**, а не до него: иначе загрузку
  переписываем дважды.
- **Чего избегать при реализации**, чтобы не привнести регресс: копий буфера на
  границе сервиса (отдаём `Buffer` как `Uint8Array`); отдельного `stat` перед
  чтением (берём `fstat` на открытом дескрипторе); `fs.promises.readFile` на
  больших файлах без проверки бенчем — он читает иначе, чем `readFileSync`,
  разницу надо замерить на `xl`, а не предполагать.
- **Порог размера.** `TOO_LARGE` в `FileOperationResult` — дешёвая защита уже в
  PR 1: отказ или подтверждение на файле выше лимита вместо молчаливых 88 с.

---

## 11. Что НЕ делаем

- **RPC-мостов.** Процесс один; сервис — DI-шов, а не транспорт.
- **Синхронных методов в `IFileService`** (вариант B).
- **`VSBuffer`, потоков, buffered open/read/close** — до этапа 4 OpenPerformance.
- **Единого `watch()` с корреляциями**; `IFileWatcher`/`ITreeFileWatcher` не
  переписываем.
- **Записи через провайдеров расширений** в UI-процессе — до первого потребителя.
- **Backup / hot exit**, режимы orphaned/error модели — отдельная фича, в
  эталоне живёт в той же модели, но к шву отношения не имеет.
- **Разбора `TextFileModel` на части** (кодировки, EOL, undo, save-участники):
  из 903 строк к IO относятся ~80. Сервис вынимает именно их; остальное —
  отдельный рефакторинг, если понадобится.
- **Переезда state/configuration/keybindings/extensionManagement/поиска** на
  сервис.
- **Смены формы событий** — это [Events](Events.md); срок жизни подписок и
  регистраций провайдеров — [Lifecycle](Lifecycle.md).
- **Правок в tuidom.** Не требуется: `getChildren` уже принимает `Promise`.

---

## 12. Открытые вопросы (решать человеку)

1. **PR 5 (асинхронная загрузка) — сейчас или вместе со стримингом?**
   Рекомендация — вместе. Цена ожидания: `textFileModel.ts` остаётся в списке
   исключений гейта, чтение остаётся синхронным.
2. **Тесты PR 5: codemod на `await` или постепенный перевод на in-memory
   провайдер?** Первое — механика на ~570 мест, второе — дольше, но разгружает
   прогоны на слабой машине.
3. **История навигации:** оставить предварительную проверку существования
   (тогда `isReachable` асинхронный и прореживание переписывается) или перейти
   на поведение эталона — выбрасывать запись по неудаче открытия?
4. **Undo удаления в корзину** — оставляем наше расширение поведения (нужен
   `ITrashService` в common) или сводим к эталону (удаление в корзину не
   отменяется из редактора)?
5. **`node:path` в common/browser** — разрешаем гейтом навсегда или заводим
   `base/common/path` и ведём те же 24 файла отдельным храповиком?

---

## 13. Найденное по пути (не чинили, не углублялись)

- Save пишет файл на месте (`writeFileSync`), не атомарно: падение посреди
  записи оставляет обрезанный файл.
- `loadDocumentFromDisk`: несуществующий файл молча открывается пустым буфером;
  ошибка чтения (`EACCES`, `EISDIR`) бросается синхронно из `openUri`, хотя его
  контракт — «никогда не отклоняется» (по чтению кода, не воспроизводил).
- `saveAs` переставляет `uri` модели до записи: если запись бросит, модель
  указывает на несуществующий путь.
- Четыре потребителя реестра декодируют байты `new TextDecoder()` — utf-8 без
  учёта BOM и `files.encoding`; дифф файла в другой кодировке покажет мусор.
- Explorer держит собственные `chokidar`-watcher'ы мимо общего обхода — бюджет
  inotify считается дважды.
- Вставка/перемещение каталога (`cpSync` рекурсивный) и безвозвратное удаление
  (`rmSync` рекурсивный) замораживают кадр на всё время операции.
- `docs/ARCHITECTURE.md` («Недисковые ресурсы») говорит, что схему `file` реестр
  не обслуживает; фактически `DiskFileSystemProvider` зарегистрирован, причём в
  `markersModule.ts`.
- Валидаторы Open File / Save As делают `existsSync` + `statSync` на каждое
  нажатие клавиши; на сетевой ФС это задержка ввода.

---

## Связанные документы

- [VscodeStructureFollowUps](VscodeStructureFollowUps.md) — пункт «Single-process
  исключения env-оси»
- [OpenPerformance](OpenPerformance.md) — этап 4 (стриминг), вехи `textfile:*`
- [Uri](Uri.md) — `untitled:`-провайдер, кэш содержимого
- [PieceTree](PieceTree.md) — документ не из одной строки
- [MultiRoot](MultiRoot.md) — N корней для Explorer и watcher'ов
- [FileTreePerformance](FileTreePerformance.md) — чтение каталогов в дереве
- [TestRunTime](TestRunTime.md) — in-memory провайдер как побочная выгода
- [Events](Events.md), [Lifecycle](Lifecycle.md) — соседние исследования
- `docs/ARCHITECTURE.md` — «Недисковые ресурсы», «Слежение за файлами», «Роли
  процессов»
