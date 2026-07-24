
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
- [~] [WhenContext](WhenContext.md) — система контекста when (остался полноценный парсер when-выражений)
- [~] [SyntaxHighlighting](SyntaxHighlighting.md) — подсветка синтаксиса (TextMate готов; далее scope-селекторы, async/background токенизация)
- [~] [Theming](Theming.md) — цветовые темы (встроенные темы из VS Code + пикер со сменой готовы; далее темы от расширений, hot-swap токен-темы)
- [~] [Diff](Diff.md) — дифф-редактор и вкладка Changes. План разбит на 7 этапов, каждый отгружается отдельно. Этапы 0 (вендоринг `DefaultLinesDiffComputer` + корпус на 58 фикстур), 1 (живой гуттер: реестр провайдеров ФС по схеме, `git:` в builtin-расширении, `QuickDiffService` — бары двигаются при наборе, до сохранения) 2 (diff view model: строки вью + свёртка неизменённых кусков) 3 (абстракция editor pane), 5 (inline diff-редактор: вкладка «файл ↔ HEAD» с подсветкой и свёрткой) и 6 (вкладка Changes: вьюлет Source Control в сайдбаре — переключается с Explorer командой, двойной клик открывает дифф) готовы, этап 4 растворился; следующий — этап 7, side-by-side и раскрытие регионов
- [ ] [PieceTree](PieceTree.md) — текстовый бэкенд документа (большие файлы, undo, snapshots)
- [~] [Extensions](Extensions.md) — VS Code-совместимые расширения (Phases 1, 8 готовы; 6, 9 частично; в работе — active-editor API)
- [~] [E2E](E2E.md) — e2e тесты против SEA-бинаря (Phase 1 и Phase 3 готовы: изолированный запуск, механика ожиданий `waitForIdle`, локаторы + `inspectState`, мышь в сценариях, параллельный прогон; открыто — кросс-платформенность Phase 1.x)
- [ ] [Inspector](Inspector.md) — рефакторинг TUIElement-иерархии + основа приложения → inspector-протокол (`--inspect-tui`) для e2e
- [~] [ReadonlyEditor](ReadonlyEditor.md) — режим «только чтение» у редактора (аналог `EditorOption.readOnly`); флаг + гейт команд + замок на вкладке + detached pane готовы; далее — конфиг-слой `files.readonly*`
- [~] [Logging](Logging.md) — единый ILogService + RingBufferSink/FileSink (Phases 1–3.5 готовы); Output UI готов; далее CLI flags, vscode API
- [ ] [LongLinePerformance](LongLinePerformance.md) — очень длинные строки (десятки тысяч символов) подвешивают UI: `DisplayLine` разбирает строку целиком, а `contentWidth` — весь документ на каждую правку
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
- Фолбэк: если ни у одного элемента нет `autofocus`, фокусить первый элемент с `tabIndex >= 0`

Файлы: `tuidom/dom/events/focusManager.ts`, `src/vs/base/browser/TuiApplication.ts`, `tuidom/dom/tuiElement.ts`
