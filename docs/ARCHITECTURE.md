# Vexx — Архитектура

Этот файл — **концептуальная карта**: обзор осей раскладки `src/vs/*`, короткие
описания каталогов со ссылками на детальные документы и правила зависимостей.
Детальный per-layer справочник живёт в [arch/](arch/) — по одному файлу на слой
(написан в терминах прежних имён слоёв; соответствие — в таблице ниже).

## Раскладка: две оси, как у vscode

С переезда на vscode-раскладку код организован по **двум осям одновременно**
(аналог upstream-правил `code-layering`/`code-import-patterns`; у нас их
проверяет `npm run valid-layers-check` — `scripts/check-layers.mjs`):

1. **Вертикальные слои** (импортировать можно только свой и нижние):

   ```
   base/common → base/node → platform → editor → workbench → vexx
   ```

   «Браузер» целиком — top-level **`tuidom/`** ВНЕ `src/vs`: DOM-ядро
   (дерево элементов, события, JSX), виджеты (`ui/*` — «HTML-элементы»),
   rendering, input, backend и Inspector (devtools). У vscode эту роль играет Chromium — поэтому tuidom не часть
   vscode-структуры и планируется к выносу в отдельный репозиторий; для
   vexx-кода он — «браузерное API» (импорты в него осями не проверяются).

2. **Окружения** внутри слоя: `common` → [common], `browser` → [common,
   browser], `node` → [common, node]. «browser» — буквально, как у upstream,
   хотя рендерим в терминал: `base/browser` — это TUIDom (наш аналог DOM).
   `vs/vexx` (сборка приложения) склеивает оба мира, env-ось к нему не
   применяется.

Имена файлов — camelCase по vscode-конвенции (`tuiElement.ts`,
`menuRegistry.ts`); тесты — колокацией рядом с кодом (наше отличие от
upstream, где они в `test/`-деревьях; оси на тесты не проверяются).

Профит раскладки — **парность путей с vscode**: наш
`src/vs/platform/configuration/common/configurationService.ts` диффается с
таким же путём upstream, будущие фичи (scm, outline, notifications…) имеют
готовые места, а знающие vscode ориентируются без обучения.

## Карта каталогов (и соответствие прежним слоям)

| Каталог | Прежний слой | Что там | Детали |
|---|---|---|---|
| `tuidom/` | TUIDom (+Widgets) + Rendering + Input + Backend + Inspector | «браузер»: DOM-ядро (`dom/`: дерево элементов, события, фокус, JSX, стили), **виджеты `ui/<widget>/`** (кнопка = «HTMLElement»; vscode-имена: scrollbar, tree, inputbox, menu, contextview, selectbox…), `rendering/`, `input/`, `backend/`, `inspector/` (devtools), `common/` (геометрия, `Disposable`, `DisplayLine`/Unicode, packed-цвета, `iTerminalSurface`), `demos/`. Кандидат на отдельный репозиторий | [arch/TUIDom.md](arch/TUIDom.md), [LAYOUT.md](LAYOUT.md), [arch/Rendering.md](arch/Rendering.md), [arch/Input.md](arch/Input.md), [arch/Backend.md](arch/Backend.md), [arch/Inspector.md](arch/Inspector.md) |
| `vs/base/common/` | Common | примитивы vexx: `Uri` (адаптер `vscode-uri`), fuzzy, `fileIcons`, ассеты (`assets/`); плюс узкие **шимы** upstream-утилит под перенесённый diff-движок (`arrays`, `arraysFind`, `assert`, `errors`, `map`, `strings`, `equals`, `charCode`) | [arch/Common.md](arch/Common.md) |
| `vs/base/node/` | Common (node-часть) | SEA/`isSea`, fs-доступ к ассетам | [arch/Common.md](arch/Common.md) |
| `vs/platform/` | размазан (Common/Configuration/Theme/Editor/Workbench) | сервисы ниже editor: `instantiation` (наш DI), `log`, `configuration` (+`ConfigurationRegistry`), `state`, `markers`, `undoRedo`, `commands`, `contextkey`, `keybinding`, `actions` (`MenuRegistry`/`MenuId`), `theme` (определения цветов + мост `defaultStyles`), `clipboard`, `files`, `environment`, `extensions`, `extensionManagement` | [arch/Theme.md](arch/Theme.md), [arch/Configuration.md](arch/Configuration.md), [arch/State.md](arch/State.md) |
| `vs/editor/` | Editor | `common/{core,model,viewModel,languages,tokens}` — текстовая модель, view-state, токенизация; `common/diff` — **дословно перенесённый** из upstream алгоритм построчного диффа (см. ниже); `browser/` — `editorElement` (виджет-мост); `contrib/{find,folding}` — модельные части фич | [arch/Editor.md](arch/Editor.md), [TODO/Diff.md](TODO/Diff.md) |
| `vs/workbench/` | Workbench (+куски Editor/Extensions/Theme) | `browser/` (Component/ThemedComponent, `workbenchComponent`, `parts/*`: editor/statusbar/panel/sidebar/dialogs/quickinput, `actions/`), `services/*` (themes, textMate, textfile, language, search, extensions, editor, layout, lifecycle, keybinding, dialogs, statusbar, output, terminalEnvironment), `contrib/<фича>/` (files, markers, output, quickaccess, find, search, suggest, terminal, themes, preferences, bulkEdit), `api/` (extension host: extHost-неймспейсы, адаптеры, RPC), `common/` (contributions-реестр, `CoreTokens`, configuration-узлы) | [arch/Workbench.md](arch/Workbench.md), [arch/Extensions.md](arch/Extensions.md) |
| `vs/vexx/` | App | точка входа `main.ts` (bootstrap: CLI → user data → configuration → assets → extensions → DI), DI-модули и профили (`modules/`) | [DI.md](DI.md) |
| `src/vscode-dts/` | Extensions/Api | `vscode.d.ts` (pinned, поверхность API) | [arch/Extensions.md](arch/Extensions.md) |
| `extensions/` | src/Extensions/builtin | builtin-расширения (языковые паки verbatim + git, vexx-settings) — как у upstream | [arch/Extensions.md](arch/Extensions.md) |
| `src/{TestUtils,StoryRunner,demos}/` | как были | dev-тулинг вне `vs/` (аналогов в upstream `src/vs` нет); в `src/demos` — app-демо, DOM/движковые демо — в `tuidom/demos` | [arch/DevTooling.md](arch/DevTooling.md) |

## Правила зависимостей

Формальную проверку обеих осей делает `npm run valid-layers-check`; признанные
отступления перечислены в `EXCEPTIONS` внутри `scripts/check-layers.mjs` (наша
single-process природа: «browser»-сторона зовёт node-сервисы напрямую, без
RPC-мостов vscode). Смысловые правила поверх осей:

- **`base/common` не импортирует ничего из проекта** (внешние leaf-зависимости — по политике из [GOAL.md](../GOAL.md); так здесь живёт `uri` на `vscode-uri`).
- **Адресация ресурсов** — любой ресурс, который пользователь открывает как буфер или дифф, адресуется `vs/base/common/uri.ts`; путь — производное (`uri.fsPath` при `scheme === "file"`). Подъём строки в `Uri` — в одной точке на слой, с `path.resolve` вплотную перед `Uri.file`. Детали → [arch/Common.md](arch/Common.md#uri).
- **Недисковые ресурсы** — читаются через `IFileSystemProviderRegistry` (`platform/files/common`): схема → read-only поставщик. Поставщиков даёт extension host (расширение регистрирует `workspace.registerFileSystemProvider`; встроенный git — схему `git:` с версией файла из ревизии), связывает их с реестром `api/browser/fileSystemProviderAdapter.ts`. Схему `file` реестр не обслуживает — файлы на диске читает `TextFileModel` напрямую.
- **Editor не зависит от темизации и расширений** — связь через интерфейсы `ITokenStyleResolver`/`ILanguageService` (`vs/editor/common/languages/`); их реализуют `workbench/services/themes` и `workbench/services/extensions`.
- **Extension host** (`vs/workbench/api/`) — единственное место, где расширения поднимаются к workbench-сервисам: адаптеры (`*Adapter` ≈ `mainThread*`) типизированы минимальными портами и связываются в DI.
- **Editor-фичи с сервисами** (find/suggest) живут в `workbench/contrib`, а не `editor/contrib` (у vscode — второе): наш DI-запрет не пускает токены в editor-слой. Осознанное отклонение — см. [TODO/VscodeStructureFollowUps.md](TODO/VscodeStructureFollowUps.md).
- **Inspector** (`tuidom/inspector`) зависит только от tuidom; транспорт — рукописный WebSocket на `node:http`; write/capture-порт `InspectorDriver` — интерфейс, адаптер даёт `vexx`-слой.

### Дословный перенос upstream: `editor/common/diff`

Алгоритм построчного диффа (`DefaultLinesDiffComputer`) и нужные ему примитивы
`editor/common/core` — **дословная копия** `microsoft/vscode` запинненного тега, а не наш
исходник. Ровно ради такого переиспользования и держится парность путей с vscode: upstream
там — чистые функции без DOM, DI и реактивщины, и ложатся они по тем же путям.

- **Управляется скриптом.** `scripts/import-vscode-diff.mjs` (`npm run import:vscode-diff`);
  режим `--check` заново выводит содержимое из upstream и сравнивает побайтно — сторож
  дрейфа. Правки руками запрещены, см. `AGENTS.md`.
- **Границу задают шимы.** Зависимости из `base/common` не переносятся: полные upstream-файлы
  тянут `cancellation → event → lifecycle → observableInternal` (~30 файлов). Вместо них —
  узкие рукописные модули по тем же путям; парность раскладки делает подмену прозрачной,
  ни один import в перенесённом коде не правится. Шимы — наш код: покрыты тестами и участвуют
  в храповике покрытия, в отличие от перенесённого.
- **Виджет не переносим.** `editor/browser/widget/diffEditor/` (24 файла) построен на двух
  monaco-`ICodeEditor`, DOM-оверлеях и `observable` — оттуда берём решения, а не строки.
- **Ловушка: два `IRange`.** В `editor/common/core/` сосуществуют наш `iRange.ts`
  (`{ start: IPosition; end: IPosition }`, используется во всём проекте) и upstream-овский из
  `range.ts` (`startLineNumber`/`startColumn`, 1-based). Потребителя у перенесённого пока нет;
  при появлении первого — решать адаптером на границе либо миграцией ядра, см.
  [TODO/Diff.md](TODO/Diff.md).

### DI-контейнер: границы использования

Примитивы DI (`Token`, `Container`, `token()`) живут в
`vs/platform/instantiation/common/diContainer.ts` (путь vscode-овский, модель
наша — токены + `static dependencies`, без декораторов), но **объявлять
конкретные DI-токены и импортировать `Container`** можно **только на уровнях
workbench и vexx** (плюс исторические исключения `*DIToken`-файлов в
platform). Сквозные токены ядра — `vs/workbench/common/coreTokens.ts`;
биндинги собираются в модулях `vs/vexx/modules/`.

Все DI-токены именуются по конвенции `*DIToken` (например
`EditorServiceDIToken`, `TuiApplicationDIToken`). Подробности — [DI.md](DI.md).
