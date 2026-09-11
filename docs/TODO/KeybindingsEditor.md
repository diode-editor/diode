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
  (`services/keybinding/`) — применение keybindings.json + запись JSONC + леджер
  для reset, **конфликты** `keybindingConflicts.ts`.

## Осознанно НЕ в PR (follow-ups)

- **File-watcher на keybindings.json** — ручные правки файла применяются после
  Reload Window, как и раньше. Live-reload потребует откатываемого user-слоя в
  диспатчере (сейчас леджер сессионный, в сервисе).
- **Валидатор keybindings.json** в редакторе (неизвестный commandId → маркер) —
  аналог `validateSettingsJson`, отдельным поставщиком `DiagnosticsService`.
- **`QuickPickItem.hint = "Configure Binding"`** в палитре команд — поле
  зарезервировано (`common/quickPickItem.ts`), не задействовано.
- **Миграция Search на `FilteredListControl`** — его шапка сложнее связки
  (include/exclude, тумблеры), потребует слота под доп. элементы.
- **`args` у user-правил** — парсится, но не исполняется (отмечено в
  `IUserKeybindingRule`).

## Известные упрощения

- **Конфликт-детекция** — when-пересечение упрощено до равенства строк (не SAT);
  ложноотрицательные возможны, это фильтр-помощник.
- **Порядок после reset** — re-регистрируемые дефолты встают в конец реестра;
  приоритет среди конфликтующих дефолтов может сместиться до Reload.
- **Терминал** — на legacy-tier часть комбинаций неразличима; рекордер
  предупреждает (`keybindingPortability.ts`), но не запрещает запись.
