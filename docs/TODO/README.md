
# Vexx — TODO

Трекер задач проекта. Каждая задача имеет статус, краткое описание и контекст.

Статусы: `[ ]` — открыта, `[~]` — в работе, `[x]` — сделана.

Завершённые задачи из трекера убираем — история живёт в git и в `docs/arch/`.

---

## Визуальный ориентир

### NVChad — референс для UI/UX
Проект: https://github.com/NvChad/NvChad

NVChad — конфигурация Neovim с красивым UI, быстрым рендерингом и продуманной визуальной частью. Ориентируемся на него в плане:
- **Внешний вид**: цветовые темы (base46), statusline, tabufline, общая эстетика
- **Иконки**: nvim-web-devicons — файловые иконки, иконки типов файлов в дереве и табах
- **Рендеринг UI-элементов**: telescope (fuzzy finder с превью), nvim-tree (файловое дерево), cheatsheets
- **Цветовые схемы**: onedark и другие темы из base46 как отправная точка для палитры

Ключевые плагины NVChad для вдохновения:
- [base46](https://github.com/NvChad/base46) — темы и подсветка
- [NvChad UI](https://github.com/NvChad/ui) — statusline, tabufline, theme switcher
- [nvim-web-devicons](https://github.com/kyazdani42/nvim-web-devicons) — иконки файлов
- [telescope.nvim](https://github.com/nvim-telescope/telescope.nvim) — поиск файлов с превью
- [nvim-tree.lua](https://github.com/kyazdani42/nvim-tree.lua) — файловое дерево

---

## Крупные задачи

- [~] [WorkbenchContributions](WorkbenchContributions.md) — перенос vscode contribution points (реестр contributions #164, MenuRegistry #166, vscode-канон меню #168 — меню-бар на реестре, co-location placement, IMenu, MenuId-класс; QuickAccess #169, Configuration #170, Color #171 — все contribution points перенесены)
- [~] [VscodeStructureFollowUps](VscodeStructureFollowUps.md) — follow-up'ы после big-bang переезда на vscode-раскладку `src/vs/*` (осознанные отклонения от канона)
- [x] [TuidomContracts](TuidomContracts.md) — нестыковки в контрактах ядра tuidom по аудиту зрелости (2026-07-27); **все Н1–Н8 закрыты (2026-08-01)**, решения записаны в LAYOUT.md/STYLES.md; документ остаётся стражем (фильтр нестыковок + проверенный список аддитивного), пока tuidom живёт в этом репо
- [ ] [TuidomExtraction](TuidomExtraction.md) — аудит перед выносом tuidom в отдельный репозиторий: что из него по смыслу редакторное и должно вернуться назад (блокер — `textLimits.ts`; tuidom в остальном чист; `displayLine` остаётся); контрактный критерий готовности — [TuidomContracts](TuidomContracts.md)
- [~] [ListControls](ListControls.md) — два списочных контрола: data-driven `TreeViewElement` остаётся намеренно (внешнее API расширений — `TreeDataProvider`), `ListViewElement` — для собственных списков workbench; техдолг — дублирование механик и union-instanceof в `listFocus`/`list.*`
- [~] [WhenContext](WhenContext.md) — система контекста when (остался полноценный парсер when-выражений)
- [~] [SyntaxHighlighting](SyntaxHighlighting.md) — подсветка синтаксиса (TextMate готов; далее scope-селекторы, async/background токенизация)
- [~] [Theming](Theming.md) — цветовые темы (встроенные темы из VS Code + пикер со сменой готовы; далее темы от расширений, hot-swap токен-темы)
- [~] [Diff](Diff.md) — дифф-редактор и вкладка Changes. План разбит на 7 этапов, каждый отгружается отдельно. Этапы 0 (вендоринг `DefaultLinesDiffComputer` + корпус на 58 фикстур), 1 (живой гуттер: реестр провайдеров ФС по схеме, `git:` в builtin-расширении, `QuickDiffService` — бары двигаются при наборе, до сохранения) 2 (diff view model: строки вью + свёртка неизменённых кусков) 3 (абстракция editor pane), 5 (inline diff-редактор: вкладка «файл ↔ HEAD» с подсветкой и свёрткой) и 6 (вкладка Changes: вьюлет Source Control в сайдбаре на `ListViewElement` — режимы плоско/дерево, инлайн-кнопка Open File, контекстное меню, активация открывает дифф напрямую одной вкладкой) готовы, этап 4 растворился; следующий — этап 7, side-by-side и раскрытие регионов
- [x] [SourceControlGraph](SourceControlGraph.md) — панель GRAPH: настоящий граф коммитов (порт pipe-модели lazygit), страница истории с «Load More…», бейджи refs и команды на коммите — включая Reset to Commit, которого в VS Code нет. Реализовано; в документе остались follow-up'ы (пикер ref'ов, compare/diff коммита, действия на бейджах)
- [~] [SourceControl](SourceControl.md) — полный Source Control как в VS Code: группы ресурсов (Staged/Changes/Merge/Untracked), stage/unstage/discard с multi-select, встроенный commit input box, sync/branch/stash/remote и меню «⋯» с подменю. Спека команд + user stories US-1…32 (приёмочный чек-лист e2e) готовы; реализация — фазы 1–12 по трекеру в документе
- [~] [Search](Search.md) — поиск по файлам (ripgrep в сайдбаре). Готово: движок rg + пакетирование в SEA, поиск по мере ввода с тумблерами Aa/`\b`/`.*`; панель — merged одно-view контейнер с «⋯»-меню (View as List/Tree с галочкой, поэтапный Collapse All/Expand All), include/exclude за «···» (Ctrl+Shift+J), режимы list/tree VS Code-семантики (дерево каталогов со сжатием цепочек), кольцо фокуса Down/Up, Enter/клик открывает файл на позиции матча. Дальше — кросс-платформенный rg, replace
- [ ] [PieceTree](PieceTree.md) — текстовый бэкенд документа (большие файлы, undo, snapshots)
- [~] [Extensions](Extensions.md) — VS Code-совместимые расширения (Phases 1, 8 готовы; 6, 9 частично; в работе — active-editor API)
- [~] [LSP](LSP.md) — стоковые language servers поверх extension host (клиент — builtin `vexx-lsp-typescript` на стоковом `vscode-languageclient`). Платформа готова end-to-end со стоковым `typescript-language-server`: document sync (didOpen/didChange живого буфера), Go to Definition (F12, кросс-файловый), диагностики → MarkerService (squiggle + Problems). Далее — SEA-упаковка курируемых серверов, второй язык (gopls/basedpyright), закрытие остальных стабов (hover, references, rename, …) по таблице в LSP.md
- [~] [Suggest](Suggest.md) — автодополнение: подсказки стокового `typescript-language-server` в попапе (триггер-символы, серверные сортировка/фильтрация, `isIncomplete`), панель описания по Ctrl+Space с ленивым `resolve` и персистом, авто-импорт одной undo-транзакцией со вставкой. Дальше — сниппет-сессия с табстопами, markdown в описании, скролл панели
- [~] [E2E](E2E.md) — e2e тесты против SEA-бинаря (Phase 1 и Phase 3 готовы: изолированный запуск, механика ожиданий `waitForIdle`, локаторы + `inspectState`, мышь в сценариях, параллельный прогон; открыто — кросс-платформенность Phase 1.x)
- [x] [EditorGroups](EditorGroups.md) — сплиты области редактора: полоса групп по одной оси (Ctrl+\, фокус Ctrl+1..5/чорды, перенос/копия/join, resize/maximize, ось-тумблер, Open to the Side), undo и модель — на документ (реестр с ref-count), find-виджет на группу, персист полосы; API расширений — ViewColumn/showTextDocument/window.tabGroups/onDidChangeVisibleTextEditors/vscode.diff поверх snapshot-протокола, document sync пер-модель + didClose. В документе — follow-up'ы (Quick Open Ctrl+Enter, read-only на документ и др.)
- [ ] [Inspector](Inspector.md) — рефакторинг TUIElement-иерархии + основа приложения → inspector-протокол (`--inspect-tui`) для e2e
- [~] [ReadonlyEditor](ReadonlyEditor.md) — режим «только чтение» у редактора (аналог `EditorOption.readOnly`); флаг + гейт команд + замок на вкладке + detached pane готовы; далее — конфиг-слой `files.readonly*`
- [~] [Logging](Logging.md) — единый ILogService + RingBufferSink/FileSink (Phases 1–3.5 готовы); Output UI готов; далее CLI flags, vscode API
- [~] [LongLinePerformance](LongLinePerformance.md) — базовый фриз длинных строк снят порогом `STOP_RENDERING_LINE_AFTER` (ветка `worktree-long-line-perf`, не влита); межредакторная связь через кадр снята damage-tracking'ом кадра (экран — ретейн-буфер, кадр перерисовывает только повреждённые области; сплит с 10k-строкой 3.4 → 1.35 мс/клавишу). Открыто: пер-строчный кеш `DisplayLine`, reveal-по-клику, конфиг порога
- [x] [SearchPerformance](SearchPerformance.md) — тормоза курсора в дереве результатов поиска устранены полностью (случаи 1–6): кап `preview.after` у истока, кэш `DisplayLine` в лейбле, dirty-гейт кадра ввода (1 кадр на нажатие), виртуализация стилевого прохода списка, damage-tracking кадра, инкрементальная проекция при стриме; 538 мс → 0.9 мс на итерацию бенча
- [~] [FileTreePerformance](FileTreePerformance.md) — производительность больших файловых деревьев (диагностика + бенчмарки готовы; фиксы — далее)
- [ ] [EnvironmentTuning](EnvironmentTuning.md) — подсказки пользователю по тюнингу окружения (терминал/tmux/ssh); пункты — tmux extended-keys для Ctrl+Tab, лимит inotify (ENOSPC) с уведомлением как в VS Code
- [~] [Folding](Folding.md) — сворачивание кода (#86, #87); indentation-фолдинг end-to-end готов, далее — API-провайдеры расширений, region-маркеры, hover-контролы
- [~] [Uri](Uri.md) — первоклассная идентичность ресурса (#108, #107); ядро/ext-host на `Uri`, `untitled:` как схема, `workspace.fs` роутится по схеме — готово; далее реестр провайдеров ФС и `untitled:`-провайдер
- [~] [Problems](Problems.md) — панель диагностик и squiggly (маркер-сервис как в VS Code); готово: seam + squiggle + валидатор settings.json + нижняя Panel с деревом Problems (reveal, фокус); далее — счётчик в статус-баре, доп. поставщики (LSP/matchers/расширения)
- [ ] [TerminalPanelBugs](TerminalPanelBugs.md) — баги нижней Panel и терминала, найденные e2e-тестированием MVP: фокус остаётся на скрытом/умершем терминале (ввод уходит в невидимый шелл и выполняется), Toggle Terminal после смерти шелла, активная вкладка не переживает рестарт, колесо не скроллит вывод; enabler — `TUIDom.sendMouse` в инспекторе
- [~] [IntegratedTerminal](IntegratedTerminal.md) — встроенный терминал (node-pty + @xterm/headless как in-process tmux); интегрировано: вкладка TERMINAL в нижней Panel, `TerminalService`+`TerminalPanelComponent`, команды toggle/new, SEA-упаковка нативного node-pty в основном пайплайне; далее — кросс-платформенная упаковка (macOS/Windows) + CI-матрица, UX (скролбэк/выделение/копирование/ссылки/bracketed-paste), список нескольких терминалов, тема-реактивная ANSI-палитра, проброс клавиш (commandsToSkipShell)

---

## Кодировки

### [ ] `files.encoding` — дефолтная кодировка из настроек
Ось encoding в ядре и пикеры Reopen/Save with Encoding готовы (#106); детект — BOM-only,
без BOM всегда utf-8. Follow-up как в VS Code:
- **`files.encoding`** — кодировка по умолчанию для открытия/сохранения (вместо
  захардкоженного utf-8), применять в `EditorService.applyConfigurationToEditor` (`src/vs/workbench/services/editor/browser/editorService.ts`).
- **`files.autoGuessEncoding`** — эвристический детект содержимого (jschardet-подобный),
  отдельная опция поверх BOM-снифа.
- Предупреждение о некодируемых символах при сохранении (сейчас — молчаливый `?`
  от iconv-lite).

Файлы: `src/vs/editor/common/model/encoding.ts`, `src/vs/workbench/services/textfile/common/textFileModel.ts`,
`src/vs/workbench/services/editor/browser/editorService.ts`.

## Unicode и отображение символов

### [ ] Системная ширина символов: кодоген таблиц + рантайм-проба ambiguous-width
Ручная таблица в `UnicodeWidth.ts` неизбежно отстаёт от Unicode (класс бага
«пропущенный диапазон», см. закрытый #60). Два направления:
- **Кодоген** — генерировать `isWide`/`isZeroWidth` из официальных Unicode-файлов
  (`EastAsianWidth.txt` + `emoji-data.txt`) скриптом `scripts/gen-unicode-width.mjs`
  в отдельный generated-модуль. Убирает «пропущенные диапазоны» навсегда.
- **Рантайм-проба (CPR)** — ширина *ambiguous-width* символов (`·≈→↔–—…№`, EAW=A)
  и часть emoji терминально-зависимы; terminfo/`TERM` этого НЕ содержит (там только
  возможности). Единственный источник правды — спросить сам терминал: напечатать
  символ → послать `ESC[6n` (Cursor Position Report) → по ответу `ESC[row;colR`
  вычислить фактическую ширину. Одноразовый probe в bootstrap для набора спорных
  символов, кэшировать результат. Опционально — mode 2027 (grapheme clustering).

Файлы: `tuidom/common/unicodeWidth.ts`, bootstrap в `src/App/`/`main.ts`, `tuidom/backend/`.

---

## События и скролл

### [ ] #5 Пересчёт координат событий мыши в ScrollableElement
Сейчас `ScrollableElement` не корректирует `localX`/`localY` событий мыши с учётом `scrollTop`/`scrollLeft`. Потребители вынуждены вручную пересчитывать координаты (пример — `WASDScrollableElement`, строки 40–41). Нужно разобраться:
- Должен ли `ScrollableElement` автоматически транслировать координаты мыши в контентные координаты (аналогично CSS overflow scroll в браузере)?
- Или ввести хелпер / дополнительное свойство `contentX`/`contentY` в событии?
- Учесть, что `renderViewport` уже работает в терминах `viewport.scrollTop`/`scrollLeft` — координаты рендера и событий должны быть согласованы.

Файлы: `tuidom/ui/scrollbar/scrollableElement.ts`, `src/demos/WASDScrollableElement.ts`, `tuidom/dom/events/`

---

## Layout

### [ ] View-секции сайдбара — follow-up'ы
Пилот (контейнер Source Control: CHANGES + GRAPH) готов: `browser/parts/views/`
(PaneView + ViewsService), см. arch/Workbench.md. Search мигрирован на
merged одно-view контейнер (`mergeSingleView`): заголовок секции слит с
заголовком контейнера, как в VS Code, — вопрос закрыт. Осталось:
- Перенос view между контейнерами (модель уже допускает: `containerId` в
  реестре view-дескрипторов) + персист размещения.
- Explorer — миграция на merged-контейнер по готовому пути Search.
- ~~View GRAPH: настоящий граф коммитов (рёбра, ветки) вместо плоского списка~~ —
  сделано, см. [SourceControlGraph](SourceControlGraph.md); осталась активация
  коммита (показ диффа/деталей) — там же в follow-up'ах.

### [ ] #6 HFlexElement / VStack — поддержка нескольких Fill с весами
Сейчас `HFlexElement` поддерживает максимум один `fill`-ребёнок. Нужно расширить:
- Разрешить несколько Fill-детей с весами (1fr, 2fr, ...) — оставшееся пространство делится пропорционально
- Применить ту же логику к будущему VFlexElement или унифицировать в один FlexContainer(direction)

Файлы: `tuidom/ui/layout/hFlexElement.ts`

---

## Рефакторинг примитивов

### [ ] #3 IScrollable — перейти на геометрические примитивы
`IScrollable` использует отдельные числовые поля `contentHeight`, `contentWidth`, `scrollTop`, `scrollLeft`. Нужно перейти на примитивы из `Common/GeometryPromitives.ts`:
- `contentHeight`/`contentWidth` → `Size`
- `scrollTop`/`scrollLeft` → `Offset` или `Point`
- Обновить `isScrollable` и все использования интерфейса

Файлы: `tuidom/ui/scrollbar/iScrollable.ts`, `tuidom/common/geometryPromitives.ts`

---

## Фокус

### [ ] #4 Автоматический фокус на старте приложения
Сейчас при запуске приложения `activeElement` не установлен — чтобы элемент начал получать события, приходится вручную вызывать `app.focusManager!.setFocus(widget)`. Нужно:
- Продумать систему автоматической установки `activeElement` при старте: авто-фокус на первый focusable элемент, или `autofocus`-атрибут на элементе
- Поддержать `autofocus` свойство на `TUIElement` — при `app.run()` FocusManager ищет первый элемент с `autofocus` и ставит фокус
- Фолбэк: если ни у одного элемента нет `autofocus`, фокусить первый элемент с `focusable`

Файлы: `tuidom/dom/events/focusManager.ts`, `src/vs/base/browser/TuiApplication.ts`, `tuidom/dom/tuiElement.ts`
