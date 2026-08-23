# MultiCursor — мульти-курсор

Статус: `[~]` — базовая фича готова end-to-end, см. [docs/arch/Editor.md](../arch/Editor.md) →
Multi-cursor и Editor/contrib/multicursor. Ниже — что осталось.

## Что сделано

- **Слияние выделений** — `sortAndMergeSelections` в сеттере `EditorViewState.selections`:
  документный порядок и отсутствие пересечений получает любой писатель (навигация, правки,
  мышь, undo, find, расширения). Заодно `onDidChangeCursorPosition` перестал нести
  ненормализованный массив.
- **Создание кареток** — Ctrl+Alt+↑/↓ (плюс Shift+Alt+↑/↓), Alt+клик, Escape для снятия
  вторичных (гейт `editorHasMultipleSelections`), Ctrl+Shift+Alt+I на концы строк.
- **Семейство вхождений** — Ctrl+D, Ctrl+K Ctrl+D, Ctrl+Shift+L, плюс команды «назад»
  без дефолтных биндов (как в VS Code). Сессия с инвалидацией снимком.
- **Отрисовка** — все каретки ячейками при `selections.length > 1`; токен
  `editorCursor.background` заведён, `editorCursor.foreground` наконец потребляется.
- **Гейты** — автодополнение и occurrence-подсветка выключаются в мультикурсоре;
  статус-бар показывает `(N selections)`; Copy/Cut склеивают выделения переводом строки.
- Демо — `e2e/scenarios/multiCursor.scenario.ts`.

## Осталось

### [ ] Распределяющая вставка (multi-cursor paste)
Сейчас вставка кладёт один и тот же текст во все каретки. В VS Code, если число строк
в буфере равно числу кареток, каждая каретка получает свою строку — это парный жест к
мультикурсорному Copy/Cut, который уже склеивает выделения через `\n`.

Файлы: `src/vs/editor/common/viewModel/editorViewState.ts` (`insertText`),
`src/vs/workbench/browser/actions/clipboardActions.ts`,
`src/vs/editor/browser/editorElement.ts` (`handlePaste`).

### [ ] `matchCase` у Ctrl+D — связать с find-виджетом
Сейчас ось зафиксирована в `true` (осознанно, см. arch/Editor.md). В VS Code она берётся
из состояния find-виджета. Шов готов: поле `matchCase` в `IMultiCursorSearchSpec`.

Файлы: `src/vs/editor/contrib/multicursor/multiCursorSession.ts`,
`src/vs/workbench/contrib/find/browser/findService.ts`.

### [ ] Колоночное (box) выделение
`Ctrl+Shift+Alt+↑/↓/←/→` и middle-drag мышью — прямоугольное выделение. Отдельная ось от
обычного мультикурсора: нужна модель «колоночного» режима, а не просто набор кареток.

### [ ] `Ln X, Col Y (K selected)` для одиночного непустого выделения
VS Code показывает в статус-баре число выделенных символов, когда выделение одно и непустое;
у нас счётчик появляется только при нескольких каретках.

Файлы: `src/vs/workbench/browser/parts/editor/editorStatusContribution.ts`.

### [ ] `trackDSL`: два непустых выделения на одной строке
`parseSelections` берёт первый `█` на строке для всего `░`-прогона, поэтому состояние вида
«два выделения Ctrl+D в одной строке» через `parseDSL` не выражается (рендер `renderToDSL`
их отдаёт корректно). Тесты семейства Ctrl+D строят состояние кодом. Расширение парсера —
отдельная задача со своим тестом в `trackDSL.test.ts`.

Файлы: `src/vs/editor/test/common/trackDSL.ts`.

### [ ] Курсор в PNG-скриншотах (задача репозитория tuidom)
`gridToSvg` игнорирует `snapshot.cursor`, поэтому аппаратный курсор не попадает в
скриншоты **нигде** в воркбенче. Для мультикурсора это обошли (рисуем все каретки
ячейками), но одиночная каретка в демо-кадрах по-прежнему невидима.

Репозиторий: [github.com/tuidom/tuidom](https://github.com/tuidom/tuidom).

### [ ] `editor.multiCursorModifier` / `editor.multiCursorMergeOverlapping`
Настройки VS Code: модификатор мультикурсорного клика (`alt` / `ctrlCmd`) и выключение
слияния пересекающихся выделений. Шов очевиден (параметр функции слияния, чтение
модификатора в `handleMouseDown`); заводить до появления потребителя не стали — под
100 %-храповиком покрытия каждая ветка обязана прийти с тестом.
