# Multi-root и `.code-workspace` — исследование цены

Статус: **исследование, к работе не взято.** Документ отвечает на вопрос «во
что нам обойдётся мульти-рут и файлы воркспейса» и «дорожает ли ожидание».
Сам мульти-рут не реализован; из раздела 7 поставлены **предохранители 1, 3, 4,
5** (отдельный PR, наблюдаемое поведение редактора не менялось) — что именно,
отмечено там же по пунктам.

База исследования — `4c34aa66` (main на 28.09.2026).

---

## 1. Короткий ответ

- **Поверхность API расширений — НЕ самая дорогая часть.** Провод хоста уже
  везёт массив папок (`IWorkspaceFolderInfo[]` с `index`), `workspaceContains:`
  уже принимает `readonly string[]`, `asRelativePath` уже умеет префикс папки
  при `folders.length > 1`. Дорого в API ровно два места: **скоупнутая
  конфигурация** (`getConfiguration(section, scope)`, `inspect().workspaceValue/
  workspaceFolderValue`, `ConfigurationTarget`) и **жизненный цикл смены
  набора папок** (событие, которое обязано стрелять, и рестарт расширений,
  завязанных на `rootPath`).
- **Самое дорогое — не API, а два слоя ниже:** (1) конфигурация — у нас её
  workspace-слоя нет вообще, даже однопапочного `.vscode/settings.json`;
  (2) SCM — весь слой построен на «один репозиторий на окно» и разбирается
  до основания.
- **Порядок величины: ~8 PR, из них 2 крупных** (конфигурация, SCM) и ~6
  средних. Плюс сквозная правка ~30 production-файлов и ~43 тестовых.
- **Да, ожидание дорожает — но не равномерно.** Дорожает не «мульти-рут», а
  два конкретных долга: каждый новый потребитель `ExplorerService.getRootPath()`
  и каждый новый ключ настроек без `scope`. Оба чинятся **дешёвыми
  предохранителями сейчас** (раздел 7), без реализации мульти-рута.

Рекомендация: **мульти-рут целиком не начинать, предохранители поставить.**
Они стоят один небольшой PR и снимают ~80% того, что иначе накапливается.

---

## 2. Что значит «полная поддержка» (эталон vscode)

Чтобы цена была честной, вот полный список механик эталона. Дальше по тексту
ссылки на пункты этого списка.

| # | Механика эталона | Комментарий |
|---|---|---|
| M1 | `IWorkspaceContextService`: `IWorkspace { id, folders, configuration? }`, `WorkbenchState = EMPTY \| FOLDER \| WORKSPACE` | единственный источник правды о папках |
| M2 | Explorer с несколькими корнями (строки-заголовки папок) | |
| M3 | Поиск / Quick Open / индекс файлов по N корням, путь с префиксом папки | |
| M4 | SCM: N репозиториев, группировка панели по репозиториям | |
| M5 | Слои конфигурации: default < user < **workspace** < **folder** (language overrides уже есть — секции `"[lang]"`, C8) | `.code-workspace` → `settings`, `<folder>/.vscode/settings.json` |
| M6 | `scope` у каждого ключа настроек (`APPLICATION/MACHINE/WINDOW/RESOURCE/LANGUAGE_OVERRIDABLE`) — решает, можно ли переопределить ключ на уровне папки | |
| M7 | `.code-workspace`: формат (`folders`, `settings`, `extensions`, `launch`, `tasks`), относительные пути от файла, untitled-воркспейсы в user-data |
| M8 | Идентичность воркспейса: `workspace.id` → `workspaceStorage/<id>`, `storageUri` расширений, per-workspace state | |
| M9 | Команды: Add Folder to Workspace, Remove Folder, Open Workspace from File, Save Workspace As, Duplicate Workspace | |
| M10 | CLI: `diode foo.code-workspace`, `-a`/`--add` | |
| M11 | Резолвер переменных `${workspaceFolder}`, `${workspaceFolder:name}` | у нас резолвера переменных нет вообще |
| M12 | API: `workspaceFile`, `updateWorkspaceFolders`, `onDidChangeWorkspaceFolders`, честный `getWorkspaceFolder`, `RelativePattern(WorkspaceFolder, …)`, `showWorkspaceFolderPick`, `findFiles` по N папкам |
| M13 | `when`-контекст `workbenchState` (`empty`/`folder`/`workspace`) и `workspaceFolderCount` | на них висят пункты меню стоковых расширений |
| M14 | Заголовок окна с именем воркспейса, список недавних (папки **и** воркспейсы) | у нас нет ни того, ни другого — см. [Startup](Startup.md) |

---

## 3. Инвентаризация: где у нас сидит «единственный корень»

> Инвентаризация ниже — снимок на базе исследования (`4c34aa66`). Предохранитель
> 1 из раздела 7 уже поставлен: источником правды стал
> `IWorkspaceContextService` (`platform/workspace/common/`), и все перечисленные
> потребители спрашивают папки у него. Таблица оставлена как есть — она отвечает
> на вопрос «во что обойдётся мульти-рут», и цена каждого потребителя от смены
> источника не изменилась.

Источник правды на момент исследования — **строка** `rootPath` внутри
`ExplorerService` (`contrib/files/browser/explorerService.ts`). Её ставит
`WorkbenchComponent.setWorkspaceFolder(dirPath)` (`browser/workbenchComponent.ts:466`),
единственный вызов на старте — `main.ts` (первый позиционный аргумент, если
это папка) и команда Open Folder (`contrib/files/browser/fileActions.ts`).

Прямых production-потребителей корня — **десять**:

| Потребитель | Файл | Что делает с корнем | Цена мульти-рута |
|---|---|---|---|
| Дерево Explorer | `contrib/files/browser/explorerService.ts` + `fileTreeDataProvider.ts` | `new FileTreeDataProvider(rootPath)`, `getChildren(undefined) → readDirectory(root)` | **низкая**: N провайдеров либо один с виртуальным уровнем корней; `getKey` уже путь, контрол дерева менять не надо |
| Индекс файлов (Quick Open) | `services/search/node/fileSearchService.ts` | `activate(rootPath)`, один обход, `path.relative(root, …)` | **низкая**: `activate(roots)` + префикс папки в `description` |
| Текстовый поиск | `contrib/search/browser/searchComponent.ts`, `services/search/node/textSearchService.ts` | один `spawn(rg, …, { cwd: folder })` | **низкая-средняя**: N процессов rg + группировка дерева результатов по папкам |
| Quick Open открытых редакторов | `contrib/quickaccess/browser/openEditorsQuickAccessProvider.ts` | относительный путь от корня | низкая |
| References | `contrib/references/browser/referencesService.ts` | относительный путь от корня | низкая |
| Файловые операции | `contrib/files/browser/fileOperationsService.ts` | `getRootPath() ?? process.cwd()` — база для относительного ввода | низкая (нужно решение «относительно чего», см. открытые вопросы) |
| Буфер файлов дерева | `contrib/files/browser/fileTreeClipboardActions.ts` | корень как база | низкая |
| Терминал | `WorkbenchComponent.setWorkspaceFolder` → `terminalService.setWorkingDirectory` | одна cwd на все терминалы | средняя: в эталоне cwd выбирается пикером папок |
| Состояние сессии | `platform/state/node/stateService.ts` → `resolveWorkspaceStatePath(dir, folderPath)` = `sha256(путь папки)` | ключ per-project стора | **средняя**: ключом обязана стать идентичность воркспейса (M8), а не путь папки |
| Расширения | `diode/modules/extensionHostModule.ts` (провайдер `getWorkspaceFolders`) и `services/extensions/node/extensionStoragePaths.ts` | одна папка в провод + `storageUri = <workspaceStorage>/<hash(folder)>/<extId>` | средняя (та же идентичность) |

Плюс SCM — он корень не читает напрямую, но построен на «один репозиторий»:
`ScmRepoStateService` держит **один** снимок `IScmRepoState`, публикуемый
командой `diode.scm.publishRepoState`; встроенное расширение
`extensions/git/main.ts` при активации берёт `workspaceFolders?.[0]` и детектит
**один** репозиторий. Панели SOURCE CONTROL / GRAPH, quick-diff, декорации
дерева, поле коммита — всё однорепозиторное.

### Что уже готово к мульти-руту (приятные новости)

- **Провод хоста расширений.** `IWorkspaceFolderInfo { uri, name, index }`,
  нотификация `workspace.initialize` везёт **массив**; на стороне субпроцесса
  `workspaceFolders` — тоже массив, `asRelativePath` уже умеет
  `includeWorkspaceFolder` при `folders.length > 1`, `getWorkspaceFolder`
  делает префикс-матч. Менять формат провода не придётся.
- **`workspaceContains:`-активация.** `matchWorkspaceContains(scanner, folders, …)`
  уже принимает `readonly string[]` (PR #359).
- **Расширение LSP-типов.** `diode-lsp-typescript` уже читает
  `workspaceFolders.map(f => f.uri.fsPath)`.
- **Хранилище расширений.** `extensionStorageHomes(paths, workspaceFolder)` и
  `resolveWorkspaceStorageDir(dir, folderPath)` — чистые функции в одном месте:
  подмена «путь папки» → «id воркспейса» правится точечно.
- **e2e-хелпер.** `appSession.ts` уже принимает `open?: readonly string[]`
  (сейчас папкой становится только первый).
- **Контрол дерева.** `TreeViewElement` data-driven, корни — просто верхний
  уровень `getChildren(undefined)`; движок (`@tuidom/*`) трогать не придётся.

### Чего нет вовсе (предпосылки, а не мульти-рут)

Это самое важное в исследовании: три вещи отсутствуют как класс, и мульти-рут
без них не строится.

1. **Слой workspace-конфигурации** — *сделан однопапочным* (этап B ниже):
   `<папка>/.diode/settings.json` поверх профиля, `inspect().workspaceValue`
   честный. Для мульти-рута остаются слой `.code-workspace` и слои папок
   (`workspaceFolderValue`), этапы D–E.
2. **`scope` у ключей настроек (M6).** `IConfigurationPropertySchema` — это
   `{ type, default, description?, enum? }`. Поля `scope` нет, значит нет
   ответа на вопрос «этот ключ вообще можно переопределять на уровне папки».
   Своих ключей у нас всего **25** (`workbench/common/configuration/*.ts`) —
   разметить их сейчас дёшево, потом дороже.
3. **Идентичность воркспейса (M8).** Сегодня «проект» = путь папки, и от него
   производны per-workspace state и `storageUri` расширений. Понятия «этот
   набор папок / этот `.code-workspace` — один и тот же проект» нет.

Отсутствуют также: резолвер переменных `${workspaceFolder}` (M11), контекст-ключ
`workbenchState` (M13), заголовок окна и список недавних (M14 — уже открыт
в [Startup](Startup.md)).

---

## 4. Разбивка работ и оценка

Оценка в PR'ах нашего масштаба: «малый» ≈ до ~300 строк с тестами, «средний» ≈
300–800, «крупный» ≈ переписывание слоя. Гейты (покрытие 100%, мутационный балл,
e2e-сценарий на каждую видимую часть) в оценку включены — они и дают основную
долю.

| Этап | Содержание | Размер | Зависит от |
|---|---|---|---|
| **A. Ядро идентичности** | `platform/workspace/common/`: `IWorkspaceContextService` (M1), `IWorkspace { id, folders }`, `WorkbenchState`, `getWorkspaceFolder(uri)`, событие изменения. Перевод 10 потребителей с `ExplorerService.getRootPath()`. Идентичность (M8) вместо `sha256(путь)` в state и `storageUri` | средний | — |
| **B. Однопапочный workspace-слой конфигурации** — **сделан** | `<folder>/.diode/settings.json` (свой каталог, не `.vscode`) как слой поверх профиля, как у эталона; фильтр по `scope` (M6) ядра и расширений; `inspect().workspaceValue`; live-reload файла; `updateValue(…, "workspace")`. Устройство — [arch/Configuration.md](../arch/Configuration.md#слой-воркспейса-diodesettingsjson). Задел под D/E: `ConfigurationService.setWorkspaceFolders(folders)` принимает список | **крупный** | A |
| **C. Explorer + поиск + индекс на N корней** | лес корней в дереве (M2), reveal/relative-пути, N обходов индекса, N процессов rg, группировка результатов (M3) | средний | A |
| **D. Папочный слой конфигурации** | per-folder merged-модель, `getConfiguration(section, scope)` со скоупом, `workspaceFolderValue`, фильтр по `scope` ключа | средний | B |
| **E. `.code-workspace`** | формат и парсер (M7), относительные пути, untitled-воркспейсы, CLI (M10), команды Add/Remove/Save As/Open (M9), `workspace.workspaceFile` | средний | A, B |
| **F. API расширений** | реальный `onDidChangeWorkspaceFolders`, `updateWorkspaceFolders`, честный `getWorkspaceFolder` (без fallback на `folders[0]`), `RelativePattern(WorkspaceFolder, …)`, `findFiles` по N папкам, `showWorkspaceFolderPick`, резолвер `${workspaceFolder:name}` (M11), контекст-ключи (M13) | средний | A, D |
| **G. SCM на N репозиториев** | `IRepository` как сущность: `ScmRepoStateService`, `ScmChangesService`, `GraphService`, quick-diff, декорации дерева, поле коммита, меню — всё получает координату репозитория; встроенный `extensions/git` детектит репозитории по всем папкам и публикует снимки пачкой (M4) | **крупный** | A, C |
| **H. Хвост** | cwd терминала по пикеру папок, заголовок окна/недавние (M14), Welcome page с воркспейсами, двухкорневые e2e-фикстуры | средний | всё выше |

Итого: **8 PR, из них 2 крупных**.

### Где оценка может поехать

- **G (SCM)** — главный риск. Сейчас в `contrib/scm/browser/` ~20 модулей, и
  почти каждый держит «текущий репозиторий» неявно. Может оказаться не «PR», а
  собственной целью.
- **B/D (конфигурация)** — риск в том, что `scope` меняет семантику уже
  работающих ключей, а мутационный гейт на конфиге исторически привередлив.
- **Расширения из магазина.** Стоковые расширения (eslint, ruff, basedpyright,
  redhat.java) в мульти-руте ведут себя иначе: eslint дёргает `pickFolder`
  (сейчас наш `showQuickPick` всегда отдаёт `undefined` — см.
  [LSP.md](LSP.md)), `vscode-languageclient` при мульти-руте регистрирует
  `workspace/didChangeWorkspaceFolders` и требует, чтобы событие реально
  стреляло. Это не «наш код сломался» — это новая поверхность для приёмки.

### Дешёвый обходной путь, который стоит держать в уме

Смена набора папок в рантайме — самая противная часть жизненного цикла
(расширения, LSP-серверы, индексы, watcher'ы). У нас уже есть
`workbench.action.reloadWindow` (перезапуск процесса с теми же аргументами), и
эталон сам перезапускает extension host при изменениях, меняющих `rootPath`.
**v1 может честно перезагружать окно на Add/Remove Folder** — это снимает
большую часть цены этапов A/F и ничего не ломает в семантике.

---

## 5. Про «радикальное вторжение в API расширений»

Проверено по коду — вторжение **точечнее**, чем кажется, и сосредоточено в двух
местах.

**Дёшево (провод уже массивный):** `workspaceFolders`, `name`, `asRelativePath`,
`workspaceContains:`, `workspace.fs`. Менять формат RPC не надо.

**Дорого №1 — конфигурация.** `getConfiguration(section, _scope)` сегодня
принимает scope и **молча его игнорирует** (кроме языка); `inspect()` возвращает
`workspaceFolderValue: undefined` константой (`workspaceValue` уже честный —
однопапочный слой `.diode/settings.json`); `update()` с целью `WorkspaceFolder` пишет в тот же `.diode/settings.json` единственной папки (ресурс проверяется: вне папки — отказ эталона). Чтобы это стало
правдой, нужен push per-folder снапшотов в субпроцесс (сейчас едет один общий
снапшот) — то есть меняется модель `configStore` на стороне расширений.

**Дорого №2 — жизненный цикл.** `onDidChangeWorkspaceFolders` сейчас
`naiveEvent()` — подписка принимается, событие не стреляет никогда. Для
`vscode-languageclient` это не деталь: на нём висит вся мульти-рут-логика
клиента.

**Тихая ловушка, которую стоило убрать независимо от мульти-рута (снята —
предохранитель 4):** `getWorkspaceFolder(uri)` возвращал
`found ?? workspaceFolders[0]` — то есть для файла **вне** воркспейса отдавал
первую папку вместо `undefined`. В однопапочном мире это почти безобидно, в
мульти-руте — источник неверной адресации, и чем дольше живёт, тем больше
расширений на этом поведении устаканится. Теперь возвращается `undefined`, как в
эталоне; строка в матрице переведена из 🟡 в ✅.

---

## 6. Дорожает ли ожидание

Дорожает, но точечно. Разложим.

**Дорожает линейно с ростом кода:**

1. **Потребители `getRootPath()`.** Сейчас 10. Каждая новая фича, которой нужен
   «корень», добавляет сайт конверсии. Тут работает не объём (правка
   механическая), а то, что каждый сайт тянет свой тест и свой мутационный балл.
2. **Ключи настроек без `scope`.** Сейчас 25 своих. Разметка задним числом —
   это ревизия семантики каждого ключа («а этот можно переопределять на папке?»),
   а не механическая правка.
3. **e2e-сценарии.** 93 сценария, 92 открывают ровно одну папку. Мульти-рут не
   ломает их (одна папка остаётся валидным случаем), но двухкорневых фикстур
   придётся завести отдельно, и чем больше сценариев, тем больше соблазна их не
   параметризовать.

**Дорожает ступенькой (и это важнее):**

4. **Опубликованная семантика API.** Каждая ✅ в
   [API-COVERAGE](../public/API-COVERAGE.md) — обещание. `workspaceFolders`,
   `name` помечены ✅, хотя семантика однопапочная; `getWorkspaceFolder` — 🟡 с
   неверным fallback. Чем дольше это стоит, тем больше шанс, что стоковое
   расширение начнёт полагаться именно на наше поведение.
5. **SCM.** Каждый новый модуль в `contrib/scm/` с неявным «текущим
   репозиторием» — плюс к цене этапа G. Слой сейчас активно растёт (GRAPH,
   stash, sync — всё недавнее).
6. **Идентичность воркспейса.** Сейчас `sha256(путь папки)` записан в трёх
   местах (state, storage расширений, `resolveWorkspaceStorageDir`). Каждый
   новый per-workspace стор — ещё одно место, и, что хуже, ещё один формат
   на диске у пользователей, который придётся мигрировать.

**Не дорожает:** формат RPC-провода (уже массив), контрол дерева, парсер
`.code-workspace` (изолированная задача), CLI.

---

## 7. Предохранители: что стоит сделать сейчас, не делая мульти-рут

Один небольшой PR, снимающий бо́льшую часть накопления из раздела 6. Всё ниже
не меняет наблюдаемого поведения — только форму.

**Сделано** (один PR; пункты 2 и 6 сознательно не брали, причины ниже):

1. ✅ **Завести `IWorkspaceContextService` (`platform/workspace/common/`) как
   единственный источник правды о папках**, пока с семантикой 0-или-1 папки.
   Перевести на него 10 потребителей; `ExplorerService.getRootPath()` перестаёт
   быть публичным API корня. Это пункт 1 и 6 из раздела 6 закрывает целиком.
   → `IWorkspace { id, folders }`, `IWorkspaceFolder`, `WorkbenchState`
   (`empty`/`folder`), `getWorkspaceFolder(uri)`,
   `onDidChangeWorkspaceFolders`. Владелец набора папок — `WorkbenchComponent`
   (у него отдельный токен на класс с писателем, читатели видят интерфейс без
   него). `getRootPath()`/`hasRootPath()` из `ExplorerService` удалены — у него
   остался только корень собственного дерева (`setRootPath`/`onDidChangeRoot`,
   их читает `ExplorerComponent`).
2. ⏭ **Множественные сигнатуры там, где это бесплатно**: `FileSearchService.activate(roots)`,
   `TextSearchService.search(query, folders, …)`, `terminalService.setWorkingDirectories(…)`.
   Образец уже есть — `matchWorkspaceContains(scanner, folders, …)`.
   → **не взято:** если внутри всё равно обрабатывается один корень, ветка
   `roots.length > 1` неисполнима, а у нас храповик покрытия 100% и мутационный
   гейт. Честные N корней в индексе и поиске — это этап C, а не предохранитель:
   либо этап C целиком, либо сигнатуры не трогаем.
3. ✅ **Добавить `scope` в `IConfigurationPropertySchema`** и разметить 25 своих
   ключей. Поле пока никем не читается — это декларация, а не механика.
   → поле **обязательное** (в отличие от эталона, где оно опционально с
   дефолтом `WINDOW`): молча получить `window` у ключа, который на самом деле
   про папку, дороже, чем ответить на вопрос при заведении ключа. Сама ревизия
   записана таблицей в `configurationContributions.test.ts` — там и обоснование
   по группам, и сверка с эталоном.
4. ✅ **Убрать fallback `?? workspaceFolders[0]` из `getWorkspaceFolder`** —
   вернуть `undefined` для файла вне папок (семантика эталона), обновить строку
   в матрице. → сделано, строка в [API-COVERAGE](../public/API-COVERAGE.md)
   переведена из 🟡 в ✅.
5. ✅ **Ввести `workspaceId` как понятие** (сейчас — просто `sha256(путь)`), чтобы
   подмена ключа per-workspace стора не превратилась в раскопки по трём местам.
   → `computeWorkspaceId(folderPath)` в `platform/workspace/common/workspaceId.ts`;
   `resolveWorkspaceStorageDir`, `resolveWorkspaceStatePath`,
   `IStateService.openWorkspace` и `extensionStorageHomes` принимают **id**.
   Формула та же (`sha256` абсолютного пути) — раскладка на диске у
   пользователей не поменялась, и это закреплено тестом.
6. ⏭ **e2e: параметризовать хелпер на несколько папок** (`open: [a, b]` уже
   массив — пусть папкой становится не только первый элемент, когда это
   осмысленно), завести одну двухкорневую фикстуру.
   → **не взято:** двухкорневая фикстура осмысленна только когда мульти-рут
   есть; до этого она проверяла бы сама себя.

Пункты 1–2 — самая ценная часть: после них «включить мульти-рут» перестаёт быть
сквозной правкой и становится сменой реализации одного сервиса. После этого PR
пункт 1 закрыт, и следующий шаг по этапу A — раздать `IWorkspace.folders`
больше одного элемента.

---

## 8. Открытые вопросы (решать человеку)

1. **Нужен ли `.code-workspace` вообще, или хватит мульти-рута из CLI?** Файл
   тянет за собой untitled-воркспейсы, команды Save As/Duplicate, идентичность,
   `settings` внутри файла. Мульти-рут без файла (`diode a/ b/`) — заметно
   дешевле (этапы A, C, D, F, G; без E).
2. **Однопапочный `.vscode/settings.json` — брать сейчас отдельно?** Он полезен
   сам по себе (эталонное поведение, которого у нас нет), не требует мульти-рута
   и является предпосылкой к нему. Возможно, это самостоятельная задача с
   собственной ценностью, а не часть этой.
3. **Смена набора папок в рантайме — через reload окна или живьём?** Reload
   резко удешевляет A/F ценой UX.
4. **SCM-мульти-репо — часть этой цели или отдельная?** Судя по объёму, скорее
   отдельная, с собственным планом.
5. **Относительные пути ввода** (Open File, файловые операции) при N корнях —
   относительно какой папки? В эталоне — активный редактор / пикер.

---

## Связанные документы

- [Startup](Startup.md) — пустое окно, CLI-флаги; там уже отмечено, что `-a`/`--add` не брали «потому что multi-root у нас нет»
- [Extensions](Extensions.md), [docs/arch/Extensions.md](../arch/Extensions.md) — поверхность API расширений
- [docs/arch/Configuration.md](../arch/Configuration.md) — слои настроек
- [docs/arch/State.md](../arch/State.md) — per-workspace стор
- [SourceControl](SourceControl.md) — слой SCM
- [LSP](LSP.md) — таблица стабов, в т.ч. `showQuickPick`/`pickFolder`
- [API-COVERAGE](../public/API-COVERAGE.md) — матрица готовности
