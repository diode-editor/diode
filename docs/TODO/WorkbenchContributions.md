# Workbench contribution points — сближение с vscode

Перенос vscode-паттерна «declarative contribution points» в основном сделан:
реестр `IWorkbenchContribution` (#164), `MenuRegistry`/`MenuId` + меню-бар +
co-location placement + живой `IMenu` + `enablement` (#166, #168),
`QuickAccessRegistry` (#169), `ConfigurationRegistry` (#170), `ColorRegistry`
(#171). Описание — [arch/Workbench.md](../arch/Workbench.md); история — в git.

Ниже — оставшиеся хвосты. Источник сверки —
`vscode/src/vs/platform/actions/common/actions.ts` + `menuService.ts`.

## MenuRegistry → vscode-канон

- [x] **Серые пункты попапа**: `MenuItemEntry.disabled` (`@tuidom/elements` 0.6.0) —
  `MenuRegistry` отдаёт его по `enablement`; попап рисует пункт `disabledForeground`,
  стрелки его пропускают, клик и Enter ничего не делают.

- [ ] **Палитра не фильтрует по `when`** (по `enablement` — уже фильтрует):
  `CommandsQuickAccessProvider` перечисляет весь `CommandRegistry`.

- [ ] Мелочи vscode, которых по-прежнему нет: `alt` (альтернативный пункт по Alt) и
  user hide-toggle пунктов (`isHiddenByDefault` + скрытие пользователем) — требуют
  поддержки в `PopupMenuElement` и персиста; submenu-записи внутри попапов
  (вложенные меню) PopupMenu не рендерит — `getMenuItems` их игнорирует.
