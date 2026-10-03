# Система контекста (when)

## Цель

Реализовать систему контекстных условий по аналогии с VS Code `when` clause — определяет, когда команда/кейбиндинг/пункт меню активен.

`ContextKeyService` и интеграция с `KeybindingRegistry`/меню уже сделаны (описание — [arch/Workbench.md](../arch/Workbench.md), раздел про систему команд).

## Сделано (C7)

### [x] Парсер и вычисление when-выражений
`new Function` с `with`-скоупом заменён парсером грамматики VS Code
(`platform/contextkey/common/contextKeyExpr.ts`, `scanner.ts`): AST, кэш по строке,
семантика узлов upstream. Глобальный реестр имён (`registerContextKeys`,
`allContextKeys`) удалён — незнакомый ключ просто `undefined`. Снято заодно:
точечные и «несловесные» имена ключей (`foo-bar`, `2fa`, `class`) достижимы целиком,
имена из глобального объекта (`constructor`, `toString`) честно ложны, работают
`in`/`not in` (массив из `setContext`), `=~`, значение справа без кавычек
(`editorLangId == java`) — строки when из манифестов расширений и `keybindings.json`
перестали молча падать в false и больше не исполняются как JS.

### [x] Потребители структуры выражения
`keybindingConflicts.whenMayOverlap` сравнивает каноническую запись разобранных
выражений (`b && a` = `(a) && b`), `keybindingDispatcher.isFocusScopedWhen` берёт
фокус-ключи только в позиции не под отрицанием (`!listFocus` больше не пропускает
команду за захватывающий оверлей). Инвариант `builtinActions.when.test.ts`: каждая
встроенная when-строка разбирается и ссылается только на ключи, объявленные в
`ContextKeyTypes` (или на семейства `mode_*`/`cap_*`) — опечатка в when краснит сборку.

## Владение ключами (F3) — сделано

Ключи фич выставляют сами фичи (`IContextKeyContributor` + явный список
`WORKBENCH_CONTEXT_KEY_CONTRIBUTORS`), центр `WorkbenchContextKeys` опрашивает их
в своём `update()` и импортов из `contrib/` не имеет. Ключи с единственной
точкой перехода пушит владелец (окружение — `TerminalEnvContextKeysContribution`,
`panelVisible` — `LayoutService`). Смена фокуса — событие `FocusTracker`.
Правило и список контрибьюторов — [arch/Workbench.md](../arch/Workbench.md).

Сознательно не сделано:
- **Группы и история на события** (`editorGroupHasEditors`, `activeEditorGroup*`,
  `canNavigate*` по событиям `EditorService`/`HistoryService`) — опциональный шаг
  плана: на pull ключи самоисцеляются, а выигрыша кроме чистоты нет.
- **Upstream-ключ `activeViewlet`** — объявления ключей у фич (`RawContextKey`)
  в C7 сознательно не делались; заводить вместе с ними.
- **Ключи «вьюлет показан» на push** — оставлены на pull: видимость сайдбара
  меняется и мимо `SidebarService` (Ctrl+B, восстановление layout'а), события
  у `LayoutService` на это нет.
