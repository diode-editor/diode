# Workbench contribution points — сближение с vscode

Перенос vscode-паттерна «declarative contribution points» (реестры, куда фичи
кладут себя декларативно). Уже сделано:
- **`IWorkbenchContribution` + реестр фаз** (#164) — code-contributions (event-проводка).
- **`MenuRegistry` + `MenuId`** (#166) — declarative menu-contributions для контекст-меню
  (редактор, Explorer).

Ниже — follow-up'ы, где наша реализация — сознательное подмножество vscode, и куда
двигаться при желании сблизиться с каноном. Источник сверки —
`vscode/src/vs/platform/actions/common/actions.ts` + `menuService.ts`.

## MenuRegistry → vscode-канон

- [x] **Меню-бар на `MenuRegistry`** (#168): submenus (`ISubmenuContribution`, аналог
  `ISubmenuItem`) — меню-бар = submenu-записи `MenubarMainMenu` → точки
  `MenubarFileMenu`/`MenubarEditMenu`/…; спец-группа **`navigation` первой** в
  сортировке групп; `MenuService.getMenus()` (хардкод дерева) удалён,
  `MenuBarComponent` резолвит entries лениво при открытии попапа.

- [x] **Co-location placement на команде (`registerAction2`-аналог)** (#168):
  `CommandAction.menus: CommandMenuPlacement[]` + `shortTitle` («File: Copy» → «Copy»
  для меню — убрал дубль явных лейблов Explorer); `MENU_CONTRIBUTIONS` деривируется
  из `builtinActions` (`menuItemsOfAction`) + submenu-структура меню-бара.

- [x] **Живой `IMenu`** (#168): `MenuService.createMenu(menuId) → IMenu`
  (`getEntries`/`getSubmenus`/`onDidChange` по `MenuRegistry.onDidChangeMenu`);
  консюмеры (контекст-меню редактора/Explorer, меню-бар) держат `IMenu`, в реестр
  напрямую не ходят. Отличие от vscode: `onDidChange` не реагирует на смену
  контекст-ключей — у `ContextKeyService` нет событий, а все наши меню
  пересобираются при открытии. Если появится живой тулбар — добавить событийность
  контекст-ключей.

- [x] **`MenuId` как расширяемый класс** (#168): статические инстансы + `new
  MenuId("my.menu")` с проверкой уникальности id — расширения смогут заводить свои
  точки.

- [ ] Мелочи vscode, которых по-прежнему нет: `alt` (альтернативный пункт по Alt) и
  user hide-toggle пунктов (`isHiddenByDefault` + скрытие пользователем) — требуют
  поддержки в `PopupMenuElement` и персиста; submenu-записи внутри попапов
  (вложенные меню) PopupMenu не рендерит — `getMenuItems` их игнорирует.

## Другие contribution points

- [x] **`QuickAccessRegistry`** (#169) — провайдеры Quick Open регистрируются по
  префиксу (`Services/QuickAccess/`): реестр выбирает по самому длинному префиксу,
  явный массив `QUICK_ACCESS_PROVIDERS`, провайдеры `Files` (`""`, дефолтный) /
  `Commands` (`>`) / `GotoLine` (`:`) со статикой `PREFIX` (как у vscode);
  `QuickOpenService` — контроллер показа (`show(prefix)`), о префиксах не знает;
  принятие — колбэк `accept` на пункте. Будущие `@`/`#` — класс + запись в массиве.
- [x] **`ConfigurationRegistry`** (#170) — фичи регистрируют схему настроек:
  `Configuration/ConfigurationRegistry.ts` (узлы `IConfigurationNode`, дубль
  ключа — ошибка) + узлы приложения в `Workbench/Configuration/` (по файлу на
  секцию, явный массив `CONFIGURATION_CONTRIBUTIONS`). Из реестра деривируются
  defaults-слой `ConfigurationService` (`defaults.ts` удалён), известные ключи
  валидации settings.json и каталог автодополнения diode-settings (генератор
  бандлит узлы). Runtime-регистрация узлов от расширений — Phase 6 в
  [Extensions.md](Extensions.md).
- [x] **`ColorRegistry`** (#171) — определения цветов по областям в
  `Theme/colors/` (`{ defaults: { dark, light } | null, description }`, явный
  merge `COLOR_CONTRIBUTIONS`; механика — `Theme/ColorRegistry.ts`). Монолиты
  `IWorkbenchColors.ts`/`defaultColors.ts` растворены; типизация ключей
  деривируется (`WorkbenchColorKey`). Осознанное подмножество vscode: два
  слота (dark/light, hc → `themeKindOf`), без transparent/derived-цветов.
