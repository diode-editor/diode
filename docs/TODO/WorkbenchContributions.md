# Workbench contribution points — сближение с vscode

Перенос vscode-паттерна «declarative contribution points» в основном сделан:
реестр `IWorkbenchContribution` (#164), `MenuRegistry`/`MenuId` + меню-бар +
co-location placement + живой `IMenu` + `enablement` (#166, #168),
`QuickAccessRegistry` (#169), `ConfigurationRegistry` (#170), `ColorRegistry`
(#171). Описание — [arch/Workbench.md](../arch/Workbench.md); история — в git.

Ниже — оставшиеся хвосты. Источник сверки —
`vscode/src/vs/platform/actions/common/actions.ts` + `menuService.ts`.

## MenuRegistry → vscode-канон

- [ ] **Серые пункты попапа «⋯»**: у `MenuItemEntry` в `@tuidom/elements` нет поля
  `disabled` — попап рисует все пункты одинаково и даёт их выбирать. Нужна фича в
  репозитории tuidom (`disabled` + пропуск в навигации), после неё
  `IResolvedMenuItemEntry.enabled` доедет и до попапа. Сейчас недоступный пункт
  выглядит обычным, но команда не исполняется.

- [ ] **Палитра не фильтрует по `when`** (по `enablement` — уже фильтрует):
  `CommandsQuickAccessProvider` перечисляет весь `CommandRegistry`.

- [ ] Мелочи vscode, которых по-прежнему нет: `alt` (альтернативный пункт по Alt) и
  user hide-toggle пунктов (`isHiddenByDefault` + скрытие пользователем) — требуют
  поддержки в `PopupMenuElement` и персиста; submenu-записи внутри попапов
  (вложенные меню) PopupMenu не рендерит — `getMenuItems` их игнорирует.
