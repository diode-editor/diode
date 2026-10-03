# [~] ParityBacklog — список шероховатостей от пользователя (15 пунктов)

Трекер одного захода: список расхождений с VS Code, собранный пользователем при
живой работе в редакторе (ssh + tmux). Диагноз по каждому пункту снят **до**
начала работы — частью живым прогоном редактора, частью по коду; агенту не надо
его перевыводить, надо проверить гипотезу и починить.

Статусы: `[ ]` — открыта, `[~]` — в работе, `[x]` — сделана.

Волны ниже — порядок, а не жёсткие барьеры: внутри волны узлы независимы по
файлам и берутся параллельно.

---

## Как снимался диагноз

Живой прогон без сборки SEA: shell-обёртка `exec npx tsx src/vs/diode/main.ts "$@"`
отдаётся в `startHeadlessApp({ binary })` (`e2e/helpers/appSession.ts`), дальше
обычные `key`/`text`/`captureFrame`. Кадр читается `frameToText`, но **PUA-глифы
(nerd-font иконки) в текстовом дампе теряются** — выравнивание проверять по
ячейкам (`frame.cells[y * cols + x].char`), иначе дерево выглядит сломанным там,
где оно целое (ровно эта ловушка стоила ложного диагноза по пункту 12).

---

## Волна 1 — общие механизмы · [x] ВЛИТА

Эти пять механизмов разблокируют остальное; они независимы друг от друга по
файлам. Все пять влиты: #370, #369, #374, #375, #376. Диагноз ниже оставлен как
есть — это история вопроса; итог и отклонения от плана приписаны под каждым узлом.

**Два изменения видимого поведения, про которые надо знать** (оба — осознанное
выравнивание на эталон, оба в #375):

- **`node_modules` в дереве Explorer теперь ВИДЕН.** У эталона в `files.exclude`
  его нет: исходник зависимости читают, а шумит он в результатах поиска —
  поэтому он в `search.exclude`. Прежнее поведение возвращается одной строкой в
  settings.json, чего раньше не было вовсе.
- Дефолты длиннее эталонных, и критерий добавки разный: в `files.exclude` ушли
  только кеши, чьё содержимое не читают никогда (`__pycache__`, `.mypy_cache`,
  `.pytest_cache`, `.ruff_cache`), всё прочее машинное — в `search.exclude`.

### [x] M1. Bulk workspace edit — правки по закрытым файлам (пункт 4) · #370

**Симптом пользователя.** «Некоторые code actions для js не работают — Code
action failed».

**Причина.** `EditorOptionsServiceAdapter.applyWorkspaceEdit`
(`src/vs/workbench/api/browser/editorOptionsServiceAdapter.ts`) требует, чтобы
КАЖДЫЙ ресурс правки был открытой вкладкой: `anyEditorFor(resource) === null →
return false`. Файловые операции (create/rename/delete) субпроцесс отбивает ещё
до RPC. Любое действие, трогающее второй файл («Add import from …», «Move to a
new file», «Update imports»), честно отвечает `false`, а UI показывает
`Code action failed: <title>` (`browser/actions/codeActionActions.ts:63,160`).
Люфт зафиксирован в [LSP.md](LSP.md) (строка таблицы `workspace.applyEdit`).

**Что сделать.**

- Правки по ресурсу, который не открыт: читать/писать через textfile-сервис, не
  через вкладку. All-or-nothing сохранить (валидация всех ресурсов до применения).
- Файловые операции `WorkspaceEdit` (create/rename/delete). В ядре уже есть
  `workspaceEditService.applyFileEdits` — его использует Explorer
  (`contrib/files/browser/fileOperationsService.ts`), подключать его, а не писать второй.
- Undo одним шагом на весь edit (сейчас per-документ).

**Разблокирует:** пункт 6 (рефакторинги в контекст-меню), rename (F2),
organize imports по проекту, prettier на закрытых файлах.

**Итог (#370).** Сделано целиком: правки по закрытым ресурсам ложатся на диск с
сохранением кодировки и EOL, файловые операции `create`/`delete`/`rename` с
опциями `overwrite`/`ignoreIfExists`/`ignoreIfNotExists` в порядке добавления
(«Move to a new file» создаёт файл и тут же пишет в него), весь edit — ОДИН шаг
отмены. Исполнителем стал существующий `WorkspaceEditService`
(`contrib/bulkEdit/node`) — тот же, что обслуживает проводник; доступ к открытым
буферам он получает портом `IBulkEditBuffers`. Уточнение, которого в плане не
было: «открыт» — не только вкладка, модель файла живёт в реестре и без неё
(сторона диффа), и такая отвечает read-only, чтобы запись мимо живого буфера не
разъехалась с ним.

### [x] M2. NLS манифестов расширений (пункт 2) · #369

**Симптом.** «В java странные имена команд» — в палитре висит
`%java.server.mode.switch%`.

**Причина.** Резолв `%key%` по `package.nls.json` / `package.nls.<locale>.json`
не реализован вовсе. Проверено на установленном `redhat.java-1.57.*`: все 36
`contributes.commands` имеют `title: "%…%"`, рядом лежит `package.nls.json` на 33
ключа. Плюс `category` манифеста игнорируется
(`platform/extensions/common/iExtensionManifest.ts` — «остальные поля … до Phase 5»),
поэтому нет префикса `Java: `, который рисует VS Code.

**Что сделать.** Резолв одним проходом по всему дереву `contributes` на этапе
загрузки манифеста (как upstream), а не точечно у команд: те же ключи сидят в
описаниях настроек, заголовках view, `displayName`. Затем `category` → префикс
заголовка в палитре.

**Разблокирует:** пункт 6 (титулы пунктов меню — тоже nls-ключи), осмысленные
имена в ExtensionsView и в редакторе настроек.

**Итог (#369).** Резолв `%ключей%` по манифесту + категория префиксом в палитре.

### [x] M3. Подготовка запроса + fuzzy везде (пункт 9) · #374

**Симптом.** «Поиск файлов и команд с пробелом ведёт себя как-то странно».

**Причина, замерено живьём.** Два разных дефекта:

- Палитра вообще не fuzzy — `commandsQuickAccessProvider.ts:47` делает
  `cmd.title.toLowerCase().includes(filterLower)`. Запрос `toggle panel` находит
  «View: Toggle Panel Visibility», запрос `go line` — **ноль результатов**.
- Файловый пикер fuzzy, но пробел матчится буквально: `src other` — ноль,
  `file one` — находит (в имени файла реально есть пробел).

**Что сделать.** Аналог `prepareQuery` VS Code в `base/common/fuzzySearch.ts`:
сплит запроса по пробелам в термы, AND по термам, скоринг по каждому терму
отдельно. Потребители, которые надо перевести: палитра, файловый пикер
(`filesQuickAccessProvider`), пикер открытых редакторов, keybindings editor
(`FilteredListControl`), поиск в ExtensionsView.

**Итог (#374).** `prepareQuery` в `base/common/fuzzySearch.ts`; переведены
палитра, файловый пикер и его индекс, пикер открытых редакторов, Keyboard
Shortcuts. Поиск в Extensions view **оставлен подстрочным сознательно** — его
матчер часть формата реестра магазина, общего с витриной и сайтом. Горячий путь
сохранён (одно-термовый запрос стоит как раньше, два терма — вдвое). Побочное,
которое поймал CI: после перехода на термы Keyboard Shortcuts начал находить
команды, у которых термы нашлись по отдельности в id, и нужная уезжала в конец
алфавитного списка — выдачу пришлось ранжировать, как в эталоне.

### [x] M4. Слой exclude-настроек `files.exclude` / `search.exclude` (пункт 13) · #375

**Симптом.** «`__pycache__` надо заигнорить».

**Причина.** В `files.watcherExclude` он УЖЕ есть
(`workbench/common/configuration/filesConfiguration.ts`) — то есть watcher в него
не заходит, а вот Explorer и поиск его показывают: настройки `files.exclude` нет
как класса, вместо неё три захардкоженных набора.

- `contrib/files/browser/fileTreeDataProvider.ts` → `EXCLUDED_NAMES`
  (`node_modules`, `.git`, `.DS_Store`);
- `services/search/node/fileSearchService.ts` → `EXCLUDED_FS_NAMES` (те же три);
- `api/common/findFiles.ts` → `DEFAULT_FIND_FILES_EXCLUDE`;
- рядом `services/extensions/node/workspaceContainsActivation.ts` →
  `DEFAULT_WORKSPACE_CONTAINS_EXCLUDES` (этот трогать не надо — у него своя
  семантика от эталона).

**Что сделать.** `files.exclude` и `search.exclude` как настройки
(`scope: "resource"`, дефолты — набор VS Code плюс наши кеши), один матчер
глобов, три набора переезжают на него. Смежный давний пункт — в [Search.md](Search.md).

**Итог (#375).** Две настройки `scope: "resource"`, общий разбор в
`workbench/common/configuration/excludeSettings.ts`, на них переехали все четыре
потребителя (дерево — `files.exclude`; индекс Quick Open — оба; ripgrep — оба,
перед набранным в «files to exclude»; `workspace.findFiles` — только
`files.exclude`, как обещает контракт эталона). Два изменения видимого поведения
— см. шапку волны.

### [x] M5. Достижимость биндов (пункт 8 + баг палитры) · #376

**Симптом.** «В режиме ssh, tmux не работает Ctrl+Shift+E — надо поправить
бинды» и «вообще ничего не доступно в итоге» (пункт 11).

**Причина — две, и вторая хуже первой.**

1. У `workbench.view.explorer` (`browser/actions/layoutActions.ts:33`) и
   `workbench.actions.view.problems` (там же, `:113`) бинд `mod+shift+e` /
   `mod+shift+m` — ОДИНОЧНЫЙ, legacy-фолбэка нет. На legacy-терминале
   Ctrl+Shift+<буква> неразличим в байтовом потоке (`requiresExtendedKeys` в
   `platform/keybinding/common/keybindingPortability.ts` это и описывает).
2. Фолбэки, которые есть, навешены с `when: "tier == 'legacy'"` и **исчезают,
   как только tier поднимается**. У палитры это смертельно:
   `workbench.action.showCommands` держит `F1` ровно под таким гейтом
   (`contrib/quickaccess/browser/quickOpenActions.ts:51`). А tier врёт — это
   прямо описано в [EnvironmentTuning.md](EnvironmentTuning.md): под tmux 3.4 с
   kitty env-хинт поднимает `csi-u`, а расширенные клавиши tmux физически не
   доставляет. Итог в окружении пользователя: ни Ctrl+Shift+E, ни Ctrl+Shift+P,
   ни F1 — редактор без палитры.

    Таких гейтов на фолбэках десять: `editorActions.ts` (4),
    `multiCursorActions.ts` (2), `lineOperationActions.ts`, `navigationActions.ts`,
    `fileTreeClipboardActions.ts`, `quickOpenActions.ts`.

3. Третий, найденный заодно: палитра показывает НЕДОСТИЖИМЫЙ бинд. У
   `editor.action.formatDocument` первичный `shift+alt+f`, досягаемый всюду чорд
   `ctrl+k ctrl+e` — вторым; на legacy палитра всё равно рисует `Shift+Alt+F`.
   `getKeybindingForCommand` должен предпочитать бинд, достижимый в текущем tier.

**Правка асимметрична — это главное.** Два направления гейта означают разное, и
снести надо ровно одно из них:

- `tier == 'legacy'` НА ФОЛБЭКЕ — это баг: фолбэк пропадает там, где он как раз
  и нужен (tier врёт, см. выше). Такие гейты снимаем, бинд регистрируется
  безусловно — несколько биндов на команду норма VS Code.
- `tier != 'legacy'` НА КАНОНИЧЕСКОМ бинде — **осознанное решение, НЕ ТРОГАТЬ.**
  Образец — Search и SCM (`browser/actions/searchActions.ts:34-35`,
  `contrib/scm/browser/changesActions.ts:28-29`): первичным идёт безусловный
  аккорд `ctrl+k f` / `ctrl+k g`, а канонический `Ctrl+Shift+F`/`Ctrl+Shift+G`
  объявлен только там, где терминал способен его передать. Смысл в комментарии
  на месте: иначе подсказка в меню обещала бы нерабочее. Ровно эту схему и
  надо тиражировать.

**Что сделать.**

- Снять `tier == 'legacy'` с фолбэков (десять мест выше), F1 — первым делом.
- Добить вторые бинды командам, у которых единственный бинд требует
  extended-keys, по образцу Search/SCM — безусловный аккорд первичным:
  Explorer (`mod+shift+e`), Problems (`mod+shift+m`), Save As
  (`contrib/files/browser/fileActions.ts:222`), `formatDocument` (у него чорд
  уже есть, но вторым и негейченым — переставить).
- Гейт-тест: команда, у которой ВСЕ бинды `requiresExtendedKeys`, краснит сборку.
- Метка бинда в палитре/меню — достижимая в текущем tier.
- Новые безусловные бинды прогнать через `keybindingConflicts.ts`: аккорды
  `ctrl+k <буква>` разбирают общий префикс, и занятую букву легко не заметить.

**Закрывает:** пункт 8, баг F1, половину пункта 11.

**Итог (#376).** Гейт `tier == 'legacy'` снят в **11** местах (не десяти —
нашлось ещё одно), асимметрия соблюдена. Досягаемые пути добавлены Explorer
(Ctrl+K E), Problems (Ctrl+K M), Terminal (Ctrl+K T / Ctrl+K Alt+T), Save As
(Ctrl+K Alt+S), Toggle Block Comment, Organize Imports, Fold/Unfold, Copy Path,
Toggle Search Details, Toggle Editor Layout, Open to the Side, Commit, Delete
Word Left. Вторая часть новых аккордов — с модификатором (голая утекает парным
keypress'ом в документ). Подпись в палитре и меню больше не обещает нерабочее:
Format Document на legacy подписан Ctrl+K Ctrl+E вместо Shift+Alt+F — **именно
из-за этого команды форматирования выглядели отсутствующими** (жалоба «я команд
форматирования не видел»).

---

## Волна 2 — мелочь пачкой

Четыре независимых локальных узла.

### [ ] Tab по табстопам (пункт 1)

**Симптом.** «Табы двигает ровно на 4 символа — надо как в vscode, выравнивать».

**Замерено живьём.** Каретка в конце `ab` (колонка 3), Tab → `Ln 1, Col 7`.
В VS Code было бы `Col 5`.

**Причина.** `EditorViewState.indentUnit()`
(`editor/common/viewModel/editorViewState.ts:1848`) — `" ".repeat(this.tabSize)`.
Нужно `tabSize - (visibleColumn % tabSize)`.

**Грабля.** Значение зависит от колонки КАЖДОЙ каретки, поэтому одним
`this.type(unit)` уже не выразить — нужна вставка своей строки на каждую
каретку. Видимая колонка считается по `DisplayLine` (табы в тексте слева тоже
выравнены по стопам), а не по символьному offset'у. То же касается `shiftIndent`
для мультистрочного выделения.

### [ ] `collapsed` у дескриптора view + GRAPH свёрнут (пункт 7)

**Симптом.** «Граф бы держать свёрнутым по умолчанию».

**Причина.** У `IViewDescriptor`
(`workbench/browser/parts/views/viewsService.ts:66`) нет поля `collapsed`
(в VS Code есть), `registerView` его не прокидывает, `PaneViewElement` всегда
создаёт пэйн с `collapsed: false`.

**Что сделать.** Поле `collapsed?: boolean` → `rebuildPanes`; персист
свёрнутости (`restoreViewsState`) должен ПЕРЕБИВАТЬ дефолт, иначе граф будет
сворачиваться на каждом старте. Выставить его у `SCM_GRAPH_VIEW_ID`
(`contrib/scm/browser/graphViewComponent.ts`).

### [ ] Иконка каталога в дереве файлов (пункт 12, вероятная причина)

**Симптом.** «Странный косяк при Open Folder — как будто не работает».

**Что проверено.** Open Folder функционально РАБОТАЕТ: корень сменился, дерево
наполнилось, терминал и индекс переехали. Сломано восприятие — снято по ячейкам
кадра:

```
строка каталога: SP  U+F105(▸)  SP  'l' 'i' 'b'            → метка на колонке 3
строка файла:    SP  SP         SP  U+E609()  SP  'R' …  → метка на колонке 5
```

`FileTreeDataProvider.getTreeItem` для `isDirectory` не отдаёт `icon` вовсе
(`contrib/files/browser/fileTreeDataProvider.ts:51`), у файлов иконка есть. Формат
строки движка — `indent + expandIcon + " " + icon + label`, поэтому метки файлов
стоят на 2 колонки правее меток каталогов, и корневой файл читается как
вложенный в предыдущий каталог.

**Что сделать.** Иконка каталога (открытая/закрытая, как `nvim-tree`) либо
резерв клетки иконки у каталогов. Пользователь перепроверит пункт 12 после
этого — если «не работает» было про другое, вернёмся с его репро.

### [ ] Значки `$(name)` во всех раковинах (пункт 3)

**Симптом.** «Иконки через `$` не показываются».

**Причина.** `renderCodicons` (`base/common/codicons.ts`) написан и работает, но
подключён в ТРИ места: `extensionStatusBarAdapter.ts`, `notificationToast.ts`,
`messageDialog.ts`. Везде остальном текст от расширения уходит в UI как есть.

**Что сделать.** Ревизия раковин «текст, который написало расширение» и единый
хелпер на каждой:

- `api/browser/quickInputExtensionAdapter.ts` — label/description/detail пунктов
  `showQuickPick`, title/prompt/validation `showInputBox`;
- заголовки палитры (титулы команд расширений),
- имена каналов Output,
- заголовки view/контейнеров от расширений (когда появятся — пункт 6),
- SCM: placeholder инпута, заголовки групп.

Тест обязан быть перечнем раковин, иначе следующая раковина снова приедет без
подмены.

---

## Волна 3 — фичи

### [ ] Prettier и выбор форматтера (пункт 5)

Отдельный документ: [Formatting.md](Formatting.md).

Пользователь явно сузил охват: **сначала prettier, остальная система потом.**

### [ ] Режим предпросмотра вкладок (пункт 14)

Отдельный документ: [PreviewEditors.md](PreviewEditors.md).

### [ ] `contributes.menus` и полное контекст-меню редактора (пункт 6)

**Симптом.** «Правая кнопка — надо затащить туда то, что тащит vscode:
рефакторинги, go to, поиск референсов; может имеет смысл сделать интеграцию
contributes.menus».

**Состояние, снято кадром.** В `MenuId.EditorContext` живут только Copy / Cut /
Paste / Undo (`browser/actions/clipboardActions.ts`, `editorEditActions.ts`).
`contributes.menus` и `contributes.submenus` НЕ реализованы — в
`platform/extensions/common/iExtensionManifest.ts` они закомментированы как
«Phase 2+». Сам реестр (`platform/actions/common/menuRegistry.ts`, `menuId.ts`,
`menuService.ts`) и контекст-меню редактора
(`editor/contrib/contextmenu/browser/contextMenuController.ts`) есть и работают —
не хватает именно моста от манифеста и состава пунктов.

**Зависимости.** M2 (титулы пунктов — nls-ключи), M1 (рефакторинги без
bulk-edit всё равно будут отвечать «failed»), плюс нужен rename-провайдер —
один из 19 `register*Provider`, которые пока no-op (таблица в [LSP.md](LSP.md)).

**Что сделать.**

1. Состав `EditorContext` как в VS Code: Go to Definition / Go to References
   (оба уже есть командами), Rename Symbol, Change All Occurrences, Format
   Document, Refactor…, Source Action…, затем clipboard-группа, затем Command
   Palette. Группы и порядок — дословно upstream'ские (`1_modification`,
   `navigation`, …).
2. `contributes.menus` → `MenuRegistry`: мэппинг строковых id VS Code
   (`editor/context`, `explorer/context`, `scm/resourceState/context`,
   `view/title`, `commandPalette`, …) на наши `MenuId`, `group@order`, `when`,
   `alt`; неизвестный id — игнор с одной строкой в лог, а не падение.
3. `contributes.submenus`.

Хвосты самого `MenuRegistry` (серые пункты попапа, `when`-фильтр палитры,
`alt`/hide-toggle/вложенные подменю) ведутся в
[WorkbenchContributions.md](WorkbenchContributions.md) — этот узел их доедает.

### [ ] Раскладко-независимые бинды (пункт 15)

**Симптом.** «Сломался маппинг по keycode — комбинации не работают в других
раскладках (Alt+F не работает в другой раскладке)».

**Причина.** Фолбэк по физической клавише в `matchesBinding`
(`platform/keybinding/common/keybindingRegistry.ts:296`) ЕСТЬ, но он под
условием `event.ctrlKey || event.metaKey` — Alt в него не входит. И даже если
условие расширить, у Alt-клавиш `code` не приезжает: токен `esc-char`
(`@tuidom/core/input/convertToken.js`) отдаёт только символ (`"ф"`) без `code` —
в отличие от `ctrl-char`/`esc-control`, которые выводят `code` из
управляющего байта, почему Ctrl+S в кириллице и работает.

**Что сделать.**

1. Расширить `code`-фолбэк на `altKey` (одна строка, помогает там, где `code`
   пришёл — kitty/csi-u).
2. Позиционная таблица раскладок (ЙЦУКЕН→QWERTY и соседи) для случая, когда
   `code` отсутствует: сопоставление идёт по символу, приведённому к базовой
   раскладке. Решение по месту: таблица — НАША политика (аналог `nativeKeymap`
   upstream), в движок за ней не идём — он честно отдаёт символ, который прислал
   терминал.
3. Проверить заодно Alt+<буква> меню-бара (Alt+V/Alt+F) — это вторая дверь из
   тупика пункта 11, и она закрывается тем же механизмом.

### [ ] Кнопка закрытия нижней панели (пункт 10)

**Симптом.** «Кнопка закрытия нижней панели».

**Причина.** `PanelContainerElement` (`@tuidom/elements/panel`) даёт `actions`
только ПЕР-VIEW («контролы справа от таб-строки», там живёт селектор каналов
Output). Панельных контролов (`✕` закрыть, `⌄` свернуть) в API виджета нет.

**Что сделать — через движок.** По правилу AGENTS.md ограничения tuidom не
обходим: нужен PR в [tuidom](https://github.com/tuidom/tuidom) — панельные
actions / `onClose` у контейнера. **Публикацию версии спросить у пользователя**
и до выхода версии на неё не завязываться. Альтернатива — забрать виджет к
себе, он и так в плане
[EngineWidgetRepatriation](EngineWidgetRepatriation.md) (`panel/`); тогда
решение целиком наше, но объём больше.

Команда `workbench.action.togglePanel` (Ctrl+J) уже есть — кнопка зовёт её.

### [ ] Паритет «папка не открыта» (пункт 11)

**Симптом.** «Странное поведение sidebar если открыть только файл — вообще
ничего не доступно в итоге, расширения например или поиск».

**Решение по activity bar: НЕ делаем** (решение пользователя; «активити бар не
надо — пропускай»). Переключение вьюлетов остаётся командным, как и записано в
[arch/Workbench.md](../arch/Workbench.md).

**Что остаётся.**

- Главное уже закрывает M5: без достижимых биндов и палитры из состояния «открыт
  один файл» выйти было нельзя вовсе.
- Welcome-состояние Explorer: сейчас плоская строка `No folder opened.` (снято
  кадром). В VS Code там `viewsWelcome` с кнопкой Open Folder. Контейнеры
  регистрируются независимо от папки с #362, так что это именно содержимое
  пустого состояния.
- Search / SCM без папки: сказать честно, что нужна папка, а не молчать.
- Вход в меню-бар с кириллицы (Alt+V) — пункт 15.

Смежно: welcome page и список недавних папок ведутся в [Startup.md](Startup.md).

---

## Пункты, снятые с захода

- **Пункт 12 (Open Folder)** — функционально воспроизвести не удалось, остаётся
  вероятная причина «дерево выглядит вложенным» (волна 2). Пользователь
  перепроверит сам; если симптом другой — вернётся с репро.
