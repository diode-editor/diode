# Редактор Keyboard Shortcuts

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).
Слои кейбиндов, when и досягаемость — [Commands.md](Commands.md).

Редактор keyboard shortcuts как в VS Code.

- `contrib/preferences/browser/preferencesActions.ts` — `Preferences: Open
  Keyboard Shortcuts` (Ctrl+K Ctrl+S) открывает вкладку UI, а `…(JSON)` —
  `keybindings.json` (VS Code parity; прежний биндинг вёл в JSON).
- `contrib/preferences/common/keybindingsEditorModel.ts` — чистая модель строк
  (`listBindings()` × `listCommands()` → `IKeybindingItem`, строка на каждую
  запись реестра плюс команды без биндинга) и фильтр (`@source:`, `@conflicts`,
  fuzzy по title/id/комбинации).
- `contrib/preferences/browser/keybindingRows.ts` — чистая раскладка колонок
  `Command | Keybinding | When | Source` под ширину (табличного контрола в
  tuidom нет — колонки считаются руками, приём `extensionRows.ts`).
- `contrib/preferences/browser/keybindingsEditorPane.ts` — вкладка `IEditorPane`
  с ресурсом `keybindings:global` (идентичность — `openPane`), поверх
  `FilteredListControl`; колонки пересобираются на смену ширины в раскладке
  (приём `ExtensionPageElement`). Enter/двойной клик → рекордер, контекст-меню
  Change/Add/Remove/Reset/Copy/Show Conflicts. Открытие — шов
  `IKeybindingsEditorTarget` (`EditorService` структурно, биндинг в
  `diode/modules/preferencesModule.ts`).
- `contrib/preferences/browser/keybindingRecorderComponent.ts` — модальный
  оверлей «нажмите комбинацию»: сфокусированный корень со `stopPropagation`
  отсекает диспатчер, закрытие по парному keypress (пиннинг к цели keydown).
  Предупреждает о непереносимых на legacy комбинациях
  (`platform/keybinding/common/keybindingPortability.ts`).
- `services/keybinding/common/iKeybindingsEditorService.ts` +
  `services/keybinding/node/keybindingsEditorService.ts` — единственный владелец
  user-слоя биндингов: применяет `keybindings.json` на bootstrap (переезд
  `applyUserKeybindings` из `KeybindingDispatcher`) и мутирует из UI
  (`defineKeybinding`/`removeKeybinding`/`resetKeybinding`): правка пишется в
  файл (`keybindingsFileEditor.ts`, JSONC-правки через jsonc-parser), и слой
  user реестра пересобирается из записанного содержимого целиком
  (`KeybindingRegistry.setUserKeybindings`). Журнала эффектов нет: reset просто
  убирает правила из файла, и восстановленные дефолты возвращаются на прежний
  приоритет. Контракт в `common/`, реализация в `node/` — как у
  Extensions-кластера; file-watcher нет (ручные правки — после Reload).
- `platform/keybinding/common/keybindingConflicts.ts` — конфликт-детекция
  (одна комбинация + пересекающийся when). Пересечение when упрощено до
  равенства канонической записи разобранных выражений (`serializeWhen`: `b && a`
  = `a && b`), это не SAT: ложноотрицательные возможны, детектор — фильтр-помощник.
  Известные коллизии дефолтов — [Commands.md](Commands.md#коллизии-дефолтов).

Рекордер на legacy-tier'е предупреждает о неразличимой комбинации, но запись не
запрещает. Чего нет: валидатора `keybindings.json` в редакторе (неизвестный
commandId → маркер, как `validateSettingsJson` у настроек) и подсказки
«Configure Binding» у пункта палитры (поле `QuickPickItem.hint` зарезервировано в
`common/quickPickItem.ts`). Ручные правки `keybindings.json` применяются после
Reload Window — трекер в [TODO/Profiles.md](../../TODO/Profiles.md).
