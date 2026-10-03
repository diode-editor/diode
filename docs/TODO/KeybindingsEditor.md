# KeybindingsEditor — вкладка редактирования keyboard shortcuts

Статус: `[x]` — реализовано одним PR. Аналог VS Code Keyboard Shortcuts editor.

## Что сделано

Ctrl+K Ctrl+S открывает UI-вкладку со списком всех команд и их биндингов
(таблица `Command | Keybinding | When | Source`), поиском (fuzzy + префиксы
`@source:`/`@conflicts`), рекордером комбинаций и конфликт-детекцией. Прежнее
поведение (открыть keybindings.json) — в новой команде
`workbench.action.openGlobalKeybindingsFile` (VS Code parity).

Карта кода — [../arch/Workbench.md](../arch/Workbench.md#текущие-обитатели),
Preferences-кластер. Ключевое:

- **Ядро** (`platform/keybinding/common/keybindingRegistry.ts`): `listBindings()`
  со снапшотами, пометка источника (`default`/`extension`/`user`) у `register()`,
  возврат снятых записей из `removeBindings()`, `serializeChord` (обратный
  `parseChord`), публичный `chordsEqual`.
- **Общий контрол** `FilteredListControl` (`browser/parts/views/`) — «поиск +
  список», вынесен на третьем потребителе (см. [ListControls.md](ListControls.md)).
- **Вкладка** `KeybindingsEditorPane` + чистые модель/строки
  (`contrib/preferences/`), **рекордер** `KeybindingRecorderComponent`
  (модальный оверлей), **сервис** `KeybindingsEditorService`
  (`services/keybinding/`) — применение keybindings.json + запись JSONC, слой
  user реестра пересобирается из файла после каждой правки, **конфликты**
  `keybindingConflicts.ts`.

## Осознанно НЕ в PR (follow-ups)

- **File-watcher на keybindings.json** — ручные правки файла применяются после
  Reload Window, как и раньше. Шов для live-reload есть: слой user заменяется
  целиком (`KeybindingRegistry.setUserKeybindings`), не хватает только
  наблюдателя файла.
- **Валидатор keybindings.json** в редакторе (неизвестный commandId → маркер) —
  аналог `validateSettingsJson`, отдельным поставщиком `DiagnosticsService`.
- **`QuickPickItem.hint = "Configure Binding"`** в палитре команд — поле
  зарезервировано (`common/quickPickItem.ts`), не задействовано.
- **Миграция Search на `FilteredListControl`** — его шапка сложнее связки
  (include/exclude, тумблеры), потребует слота под доп. элементы.
- ~~**`args` у user-правил**~~ — сделано: args из keybindings.json доезжают до
  `execute` первым аргументом (реестр → диспатчер → команда), редактор биндов их
  сохраняет; quick open (`workbench.action.quickOpen` и родня) принимает
  строковый префилл. Сценарий — `e2e/scenarios/quickOpenPrefill.scenario.ts`.

## Известные упрощения

- **Конфликт-детекция** — when-пересечение упрощено до равенства строк (не SAT);
  ложноотрицательные возможны, это фильтр-помощник.
- **Терминал** — на legacy-tier часть комбинаций неразличима; рекордер
  предупреждает (`keybindingPortability.ts`), но не запрещает запись.
- **Коллизии дефолтов, вскрытые срезом приоритета (F1)** — сохранены как были
  (веса повторяют прежний порядок регистрации), развести — отдельной правкой:
  - Ctrl+K Ctrl+F: `workbench.action.navigateForward` (безусловный, вес
    `WorkbenchContrib`) перебивает pc-бинд `editor.action.formatSelection`, то
    есть в редакторе на pc чорд уходит в навигацию, а не в форматирование;
  - Ctrl+K Ctrl+U: `editor.action.showHover` перебивает
    `editor.action.removeCommentLine`;
  - Escape при одновременно открытых hover и suggest закрывает hover (у нас
    hover `EditorContrib + 92` сильнее suggest `+ 90`), у upstream — наоборот.
