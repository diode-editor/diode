# Diode — TODO

Трекер задач проекта. Каждая задача имеет статус, краткое описание и контекст.

Статусы: `[ ]` — открыта, `[~]` — в работе, `[x]` — сделана.

Завершённые задачи из трекера убираем — история живёт в git и в `docs/arch/`.
Задачи движка (не хватает API/виджета/поведения tuidom) ведутся в репозитории
[tuidom](https://github.com/tuidom/tuidom), не здесь (см. AGENTS.md).

---

## Крупные задачи

- [~] [FirstRelease](FirstRelease.md) — первый публичный релиз и пост: скоуп пересмотрен 2026-10-13 (дистрибуция и витрина сделаны); открыто — честные цифры и страница бенчмарков, эссе и ответы на вопросы, кадр-доказательство на лендинге, большие файлы (этапы 2 и 4 OpenPerformance: жадные проходы, режим «только чтение» со стримингом и follow)
- [~] [PreviewEditors](PreviewEditors.md) — режим предпросмотра вкладок: фазы 1–3 сделаны (preview-флаг, курсив метки превью, замещение, прикалывание правкой/Ctrl+K Enter/сплитом, `workbench.editor.enablePreview`; клик в Explorer — превью, двойной клик и Enter — постоянная вкладка, `workbench.list.openMode`). Открыто: гейт «Keep Editor» по настройке, остальные точки открытия
- [~] [Profiles](Profiles.md) — профили пользователя: итерации 1–2 сделаны (#601, #602: реестр в `User/globalStorage/storage.json`, привязка профиля к воркспейсу, `Profiles: Switch/New/Delete Profile...` с перезагрузкой окна, эталонная семантика настроек именованного профиля, свой `extensions.json` у профиля над общим каталогом). Открыто: хвосты 1–2 (два окна на одном user-data-dir затирают `storage.json`, подсказки в settings.json профиля), итерация 3 (`useDefaultFlags`, `applyToAllProfiles`, пустое окно), итерация 4 (Profiles editor, Export/Import, горячее переключение)
- [~] [LanguageServers](LanguageServers.md) — языковые серверы поверх стокового `vscode-languageclient`: TypeScript, Python (basedpyright + ruff), eslint, Java, Go, Terraform, prettier работают; открыто — F12 при нескольких целях, гонка didClose/didOpen с folding, перезапрос неполного completion, thematic break в hover, lombok-дефолт Java, деревья и HCP у Terraform, выбор форматтера
- [~] [Tasks](Tasks.md) — задачи (tasks): первая итерация сделана (#572, #575) — Run Task / Rerun / Terminate / Restart / Show Running из `.diode/tasks.json` и провайдеров расширений, терминал задачи с честным reuse, `vscode.tasks` (провайдеры, `executeTask`, события, `CustomExecution`), Configure Task с шаблонами. Дальше — группы build/test, `dependsOn`, `inputs`, `resolveTask` провайдера, автозапуск, история пикера; problem matchers — по мере надобности (решение человека 2026-10-21)
- [~] [SecondarySideBar](SecondarySideBar.md) — вторичная боковая панель сделана (стек #649, #654, #660, #661: auxiliary bar эталона, перенос видов и контейнеров, живые TERMINAL/Output/Problems справа); открыто — `workbench.sideBar.location`, развёртывание панели, перетаскивание видов мышью, стартовый размер PTY в узкой панели, переживание перезапуска шеллом
- [~] [ClaudeCode](ClaudeCode.md) — интеграция с Claude Code: стоковое `Anthropic.claude-code` в режиме `useTerminal` в нашем магазине (v0.9.7) — `claude` вкладкой справа, контекст редактора, `getDiagnostics`, предложенный дифф с ✓/↺; открыты хвосты — уведомление на webview-команды, стоковые тесты терминала, `claude` во вторичной панели
- [~] [VscodeStructureFollowUps](VscodeStructureFollowUps.md) — follow-up'ы после big-bang переезда на vscode-раскладку `src/vs/*` (осознанные отклонения от канона)
- [ ] [EngineWidgetRepatriation](EngineWidgetRepatriation.md) — прикладные виджеты, оставшиеся в `@tuidom/elements` (completionlist, editorgroup, editorpart, terminal, menuBar; `panel` и `workbenchlayout` переехали): по критерию «публичный API не упоминает понятий Diode» им место у нас
- [~] [SyntaxHighlighting](SyntaxHighlighting.md) — подсветка синтаксиса (TextMate и семантические токены LSP готовы; скоупы темы матчит vscode-textmate; далее — шебанг и прочий language detection, `editor.action.changeLanguage`, bracket pair colorization)
- [~] [Theming](Theming.md) — цветовые темы (встроенные, пикер, live-reload, темы от расширений / установка из магазина готовы; открыто — подсветка текущей строки, группировка пикера, `IWorkbenchColors`, `workbench.colorCustomizations`)
- [~] [Diff](Diff.md) — дифф-вкладка на двух настоящих редакторах и семейство команд сравнения сделаны; открыто — интерактив (раскрытие свёртки жестом, Switch Side, F7, стрелки revert), краевые случаи (большой файл, бинарник, пробелы, дифф коммита из GRAPH) и долг (два `IRange`, неймспейс `scm`)
- [~] [SourceControl](SourceControl.md) — Source Control и GRAPH сделаны ([arch](../arch/workbench/SourceControl.md)); открыты `diode.scm.publishBusy`, UI-e2e для sync/branch/stash и follow-up'ы графа (пикер ref'ов, дифф коммита, действия на бейджах)
- [~] [Search](Search.md) — поиск по файлам: базовый срез готов; дальше — кросс-платформенный rg, replace, `search.exclude`, история запросов
- [~] [MultiCursor](MultiCursor.md) — мульти-курсор готов; дальше — распределяющая вставка, колоночное выделение, связка `matchCase` с find-виджетом
- [~] [WordWrap](WordWrap.md) — перенос строк по словам (`editor.wordWrap`, Alt+Z): v1 готова; открыты follow-up'ы (wrappingIndent, wrap в диффе, affinity, персист toggle)
- [~] [VscodeModel](VscodeModel.md) — перенос модели документа и токенизации из VS Code: B1 (фоновая и вьюпортная токенизация), A1+A2 (вендор PieceTree с upstream-тестами), A3 (`TextDocument` на PieceTree), A4 (полный текст с горячих путей) и B2 (бинарные токены VS Code, colorMap темы) сделаны; воркер (B3) замерен прототипом и отложен до этапа 2 OpenPerformance
- [~] [Extensions](Extensions.md) — VS Code-совместимые расширения и магазин (сделанное — в [arch/Extensions](../arch/Extensions.md), [arch/Marketplace](../arch/Marketplace.md)); открыто: иконки, сниппеты, on-enter rules, dispose-цепочка и горячий reload, `extensionPack`, ESM и перезапуск extension host'а, рендер деревьев расширений (TreeView) и `viewsWelcome`, id магазина без учёта регистра, `yanked`
- [x] [ExtensionUpdates](ExtensionUpdates.md) — обновление и откат расширений из UI: безопасная замена версии под живым host'ом, установка конкретной версии с закреплением (`pinned`), ручное обновление (`Check for Updates`, `Update All`), автообновление (`extensions.autoUpdate`) — все этапы сделаны (2026-10-24); хвост — межпроцессная блокировка, в [Extensions](Extensions.md)
- [~] [Suggest](Suggest.md) — автодополнение работает, авто-открытие по эталону (`editor.quickSuggestions`, уступает призраку); дальше — сниппет-сессия с табстопами, markdown в описании, скролл панели
- [~] [InlineCompletions](InlineCompletions.md) — призрачные подсказки (ghost text) v1 сделаны end-to-end (`registerInlineCompletionItemProvider`, Tab/Esc, view zones); открыты люфты (mid-line, partial accept, lifecycle-хуки, `selectedCompletionInfo`/augmentation под попапом) и часть 2 — реальный LLM-провайдер
- [~] [E2E](E2E.md) — инфраструктура готова; открыто — кросс-платформенность Phase 1.x и найденный дефект фокуса (find + вторая вкладка)
- [ ] [TestFlakes](TestFlakes.md) — живой список флаков (пополняется прямо в `main`) и открытые ходы по цене полного прогона гейтов: таймауты `vi.waitFor`, сужение dry run, шардинг мутаций, `vitest.related: false`; плюс остаток мутационного долга после линт-прогона #333
- [~] [ReadonlyEditor](ReadonlyEditor.md) — read-only редактор готов; далее — конфиг-слой `files.readonly*`, сообщение при попытке правки
- [~] [Logging](Logging.md) — ILogService + Output UI и CLI-флаги уровней (`--log`, `--verbose`) готовы; далее — inner tracing extension host, `--log-file`, фильтры/Clear в Output
- [~] [Startup](Startup.md) — параметры запуска: `diode` без аргументов поднимает пустое окно (cwd не трогаем), добавлены `-g/--goto`, `-d/--diff`, `--disable-extensions`, `--extensions-dir`, `--log`/`--verbose`; далее — welcome page и список недавних папок
- [ ] [MultiRoot](MultiRoot.md) — **исследование цены** мульти-рут-воркспейсов и файлов `.code-workspace`: инвентаризация единственного корня (10 потребителей), чего нет как класса (workspace-слой конфигурации, `scope` у ключей, идентичность воркспейса), разбивка на 8 PR (крупные — конфигурация и SCM) и список предохранителей (4 из 6 поставлены, см. раздел 7); сделаны однопапочный слой `.diode/settings.json` и файл `.code-workspace` с одной папкой (несколько закоммиченных наборов настроек над одним каталогом)
- [~] [FileService](FileService.md) — `IFileService` вместо прямого `node:fs` в UI-слоях: сделано всё, кроме PR 5 — асинхронной загрузки модели (ждёт стриминга этапа 4 OpenPerformance); открыты вопросы по тестам PR 5, истории навигации и `node:path`, плюс находки по пути
- [~] [OpenPerformance](OpenPerformance.md) — красивые бенчи открытия: линейка, кухня старта и жадные проходы сделаны (CJS-ядро в V8-снапшоте SEA, ленивые куски, кухня воркбенча; `small` ≈100 наших на CI, гейт 200; `xlarge` 13 МБ — `small` + 100 мс, клавиша после затишья 5–8 мс, гейт 350 / 20 мс); открыты хвосты кухни (ленивые тела вьюшек, ASCII-бандл, снапшот для self-extract), 5a (IPC на `v8.serialize`), токенизация от вьюпорта (этап 3), стриминг гигантских файлов и large-file режим
- [~] [LongLinePerformance](LongLinePerformance.md) — фриз длинных строк снят порогом рендера, межредакторная связь — damage-tracking'ом; открыто: пер-строчный кеш `DisplayLine`, reveal-по-клику, конфиг порога
- [~] [FileTreePerformance](FileTreePerformance.md) — производительность больших файловых деревьев (главные блокеры сняты; остались точечные фиксы)
- [~] [MacKeybindings](MacKeybindings.md) — мак-раскладка: ОС клавиатуры по лестнице сигналов (с XTVERSION), мак-рунги `legacy < extended < cmd` с `cap_super`, токен `mod`, полный паритет с мак-раскладкой VS Code 1.138 (сверка тестом со срезом эталона), Keyboard Doctor для фидбека сделаны; дальше — фидбек с живого мака, мост Cmd для tmux, найденные сверкой дыры pc-паритета
- [~] [EnvironmentTuning](EnvironmentTuning.md) — подсказки пользователю по тюнингу окружения (терминал/tmux/ssh): как доносить до пользователя (открытый вопрос), лимит inotify (ENOSPC) с уведомлением как в VS Code, детект tmux без extended-keys, подсказки маководу
- [~] [DocsSite](DocsSite.md) — сайт документации diode-editor.github.io/docs (Starlight, репозиторий `diode-editor/docs`): каркас, перевод `docs/public` на английский и Settings с поиском сделаны; открыто — `DOCS_PAT`, пересмотр контента человеком, новые страницы
- [~] [Distribution](Distribution.md) — каналы дистрибуции (`install.sh`, apt, npm, Homebrew cask, winget) работают с v0.4.0, устройство — [packaging/README.md](../../packaging/README.md); открыто — `SITE_PAT`, первая подача в winget, ручная проверка Windows-SEA, quick install на сайте, новые каналы и подпись
- [~] [Folding](Folding.md) — indentation-фолдинг и API-провайдеры готовы; далее — region-маркеры/language-configuration, hover-контролы, персист свёрток
- [~] [Uri](Uri.md) — ядро на `Uri` готово, виртуальные read-only документы (`registerTextDocumentContentProvider`) доведены до вкладки; далее — `untitled:`-провайдер, язык безымянных буферов, кэш содержимого
- [~] [TrackedDecorations](TrackedDecorations.md) — декорации маркеров едут вместе с текстом (сделано); далее — `IntervalTree`, перевод поиска/SCM/диффа на декорации модели
- [~] [Problems](Problems.md) — маркер-сервис, squiggle и панель готовы; далее — JSON Schema-валидация, problem matchers, счётчик в статус-баре, F8, клик по файлу в дереве
- [~] [IntegratedTerminal](IntegratedTerminal.md) — встроенный терминал сделан ([arch](../arch/workbench/Terminal.md)); открыто — CI-матрица macOS/Windows и необработанная ошибка спавна на неподдерживаемой платформе, UX (выделение, ссылки), сплиты/rename, minimumContrastRatio, commandsToSkipShell

---

## Extension host

### [ ] Атрибуция сбоев расширения по стеку (G7, необязательно)

Идентичность расширения сделана ([arch/Extensions.md](../arch/Extensions.md), «Идентичность
расширения»): владелец известен на создающих вызовах. Не покрыто то, что идёт мимо них:
`unhandledRejection`/`setUnexpectedErrorHandler` и `console.*` расширения. Решение — тем же
индексом корней расширений по стеку ошибки, вывод — в канал `extensions.host.<id>`.

### [ ] Одна проводка extension host'а к группе редактора (G5, необязательно)

`bindExtensionHostToEditorGroup` в `api/browser` — одна проводка вместо двух копий в
`extensionHostModule.ts` и `TestUtils/ExtensionTestHarness.ts`.

---

## Workbench

### [ ] Хвосты MenuRegistry

Основное перенесено ([arch/workbench/Menus.md](../arch/workbench/Menus.md)). Осталось:
палитра команд не фильтрует по `when` (по `enablement` фильтрует) — перечисляет весь
`CommandRegistry`; `alt`-пункты (альтернатива по Alt) и user hide-toggle
(`isHiddenByDefault` + скрытие пользователем) — нужна поддержка в `PopupMenuElement`
и персист.

### [ ] Два списочных контрола

Решение — [arch/workbench/Views.md](../arch/workbench/Views.md#общие-контролы-списков).
Техдолг двух реализаций, браться при следующей содержательной правке этих механик,
не ради симметрии: курсор, мультивыбор, typeahead, hover и `ensureVisible` —
близнецы (сближение — общий selection-модуль или `TreeViewElement` фасадом над
`ListViewElement`); ключ `listFocus` и команды `list.*` перечисляют оба класса
руками; QuickPick и CompletionList рисуют свои списки сами — кандидаты на
`ListViewElement` по реальной необходимости.

---

## Кодировки

### [ ] `files.encoding` — дефолтная кодировка из настроек

Ось encoding в ядре и пикеры Reopen/Save with Encoding готовы (#106); детект — BOM-only,
без BOM всегда utf-8. Follow-up как в VS Code:

- **`files.encoding`** — кодировка по умолчанию для открытия/сохранения (вместо
  захардкоженного utf-8), применять в `TextEditorConfiguration.apply` (`src/vs/workbench/services/editor/browser/textEditorConfiguration.ts`).
- **`files.autoGuessEncoding`** — эвристический детект содержимого (jschardet-подобный),
  отдельная опция поверх BOM-снифа.
- Предупреждение о некодируемых символах при сохранении (сейчас — молчаливый `?`
  от iconv-lite).

Файлы: `src/vs/editor/common/model/encoding.ts`, `src/vs/workbench/services/textfile/common/textFileModel.ts`,
`src/vs/workbench/services/editor/browser/editorService.ts`.

## Unicode и отображение символов

### [ ] Системная ширина символов: кодоген таблиц + рантайм-проба ambiguous-width

Таблицы `isWide`/`isZeroWidth` живут в движке (`unicodeWidth` в `@tuidom/core`) —
кодоген из официальных Unicode-файлов делается в репозитории tuidom. Наша часть —
**рантайм-проба (CPR)**: ширина _ambiguous-width_ символов (`·≈→↔–—…№`, EAW=A) и части
emoji терминально-зависима, terminfo этого не содержит; единственный источник правды —
спросить сам терминал (напечатать символ → `ESC[6n` → вычислить фактическую ширину).
Одноразовый probe в bootstrap для набора спорных символов, кэшировать результат.
Опционально — mode 2027 (grapheme clustering).

---

## Клавиатура

### [ ] Утечка парного keypress в отцепленный редактор (движок → tuidom)

Баг движка: по правилу этого файла задача уезжает в репозиторий tuidom; здесь — до заведения
её там и ради обхода на нашей стороне.

Команда, которая переключает активную вкладку, отцепляет от дерева
`EditorElement`, бывший целью её `keydown`. Парный `keypress` закреплён за той же
целью (`TuiApplication.pinnedKeypressTarget`), поэтому диспатчится от
отцепленного узла — глобальный capture-обработчик
`KeybindingDispatcher.handleKeyPressCapture` на корне **не вызывается**,
`swallowNextKeyPress` не срабатывает, и клавишу обрабатывает сам устаревший
редактор.

Воспроизведение (было при разработке истории навигации): повесить `Go Back` на
аккорд `Ctrl+K -`, открыть два файла, уйти кареткой, нажать аккорд — команда
отрабатывает правильно, но символ `-` печатается в документ, который мы только
что покинули (вкладка становится modified). С `Ctrl+K D` (`compareWithSaved`)
утечки нет — там `keypress` до корня доходит.

Обход на нашей стороне: вторая часть аккорда — клавиша с модификатором
(редактор её игнорирует сам), см. `navigationActions.ts` и «Конвенции системы
команд» в arch/workbench/Commands.md. Настоящее лечение — в
[tuidom](https://github.com/tuidom/tuidom): если закреплённая цель больше не в
дереве приложения, `keypress` надо гасить (или диспатчить от корня), а не
доставлять мимо капчер-обработчиков.

---

## Layout

### [ ] View-секции сайдбара — follow-up'ы

Пилот (контейнер Source Control) и merged одно-view контейнеры (Search) готовы —
`browser/parts/views/`, см. arch/workbench/Views.md. Осталось:

- Перенос view между контейнерами (модель уже допускает: `containerId` в
  реестре view-дескрипторов) + персист размещения.
- Explorer — миграция на merged-контейнер по готовому пути Search.

## Настройки

### [ ] Дифф настроек не видит ключи-шаблоны с точкой

`diffConfigurationKeys` (`platform/configuration/common/configurationChangeEvent.ts`)
собирает листовые ключи через `collectKeys()` и сравнивает `get(key)`, а `get`
режет ключ по точкам. У `files.exclude` ключи — glob'ы: `"**/*.log"` даёт ключ
`files.exclude.**/*.log`, `get` ищет `…["**/*"]["log"]` и с обеих сторон получает
`undefined` — правка не порождает события, дерево и поиск её не видят до
перезапуска. Найдено на тесте `explorer.compactFolders` (там шаблон без точки).
Лечение — сравнивать поддеревья по сегментам `collectKeys`, а не через `get`.

## Отмена (undo)

### [ ] Шаг нескольких документов: разбиение по файлам, как у эталона

Шаг `workspace.applyEdit` лежит в истории всех затронутых буферов
(`UndoRedoService.pushWorkspaceElement`), но не разбивается: нет диалога эталона
«Would you like to undo '…' across all files? — Undo in N Files / Undo this
File» для чисто текстовых многофайловых правок (rename symbol) и отката «только
этого файла», когда соседний файл правили после шага (у нас — отказ с тостом).
Решение человека при работе над «Move to a new file»: разбиение — отдельной
задачей. Нужны трёхкнопочный диалог (у `DialogService` только confirm) и шаг из
частей по документу (`MultiModelEditStackElement.split` эталона).

### [ ] Буфер остаётся «изменённым» после отмены до сохранённого текста

`isModified` сравнивает `versionId` документа с сохранённым, а отмена версию
поднимает: набрал букву и отменил — вкладка всё равно с «●». Эталон считает
грязность по `alternativeVersionId` (у отмены и повтора — версия того шага,
куда вернулись). Задевает любую отмену, в том числе откат «Move to a new
file» и закрытие вкладки удалённого файла (изменённую вкладку не закрываем).
