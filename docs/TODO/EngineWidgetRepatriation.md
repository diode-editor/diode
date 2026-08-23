# Прикладные виджеты в движке: что ещё вернуть к нам

Критерий уже записан с обеих сторон и одинаков:

- diode, [../arch/Workbench.md](../arch/Workbench.md), «Где живёт Element»: элемент общего назначения (его публичный API не упоминает понятий Diode) — в движке; Diode-специфичному там не место, он либо не существует вовсе (компонент — композиционный корень из примитивов), либо живёт рядом со своим компонентом в `parts/*`.
- tuidom, [docs/arch/TUIDom.md](https://github.com/tuidom/tuidom/blob/main/docs/arch/TUIDom.md): «В `@tuidom/elements` остаются только виджеты общего назначения — чей публичный API не упоминает понятий Vexx».

Quick pick по этому критерию переехал (2026-08-23): собран из `InputElement` + `ListViewElement` + флексов, живёт в `src/vs/workbench/browser/parts/quickinput/`. Он был не единственным нарушителем — ниже остальные кандидаты, по прикидке примерно половина пакета `@tuidom/elements`.

## Кандидаты

Однозначно прикладное — публичный API оперирует понятиями IDE:

- [ ] `completionlist/` — `CompletionListElement` + `completionDetailsElement` + `completionWidgetElement` + `completionItemKindIcon`. Модель `CompletionListItem` с `sortText`/`filterText` — прямо LSP; док класса ссылается на диодовский `completionService`, то есть движок документирован через потребителя.
- [ ] `editorgroup/` — `EditorTabStripElement` + `EditorTabItemElement` (`TabInfo`).
- [ ] `editorpart/` — `EditorPartElement`, сетка групп редактора (`MIN_GROUP_MAIN_COLS/ROWS`).
- [ ] `workbenchlayout/` — `WorkbenchLayoutElement`: activity bar / side bar / panel / status bar.
- [ ] `panel/` — `PanelContainerElement` + `PanelView`.
- [ ] `terminal/` — `TerminalViewElement` + `encodeKeyForPty`.
- [ ] `menu/menuBarElement.ts` + `menuBarItemElement.ts` — строка меню приложения.
- [ ] `contextview/contextMenuController.ts` — это уже сервис, а не элемент.

Пограничное — решить осознанно, а не по инерции:

- [ ] `tree/treeViewElement.ts` — само дерево общего назначения, но `iTreeDataProvider.ts` заточен под файловый эксплорер.
- [ ] `menu/popupMenuElement.ts` — примитив, но `MenuEntry` со шорткатами и сабменю — модель VS Code.

Настоящие примитивы, которые остаются в движке: `layout/*`, `text/*`, `inputbox/*`, `button`, `sash`, `scrollbar/*`, `selectbox`, `list/listViewElement.ts`.

## Хвост в ядре

`packages/core/src/dom/styles/styleTokens.ts` держит дефолты токенов, включая прикладные (`menu.shortcutForeground`, `titledPanel.*`, `menuBar.*`). С каждым переехавшим виджетом соответствующие токены становятся сиротами и должны уезжать в наш реестр цветов (`src/vs/platform/theme/common/colors/`), как это сделано с `quickPick.*`.

## Как переносить

Рецепт, отработанный на quick pick:

1. Собрать составной элемент у нас из примитивов движка; ручной `render()` оставлять только там, где его правда нельзя выразить композицией (у пикера это оказалась одна рамка с врезанным заголовком).
2. Модель данных — в `common/`, если её импортирует common-код (иначе ось окружений `common → browser` не пройдёт `valid-layers-check`).
3. Токены — в наш реестр цветов с `{ defaults: { dark, light }, description }`.
4. Тесты рядом, через обёртки `src/TestUtils/renderElement.ts` и `expectScreen.ts`.
5. Только после того как diode перестал импортировать виджет — сносить его из движка отдельным PR и релизить пакеты.

Критерий готовности файла: по каждому кандидату принято и записано решение (перенести или осознанно оставить), прикладных токенов в `styleTokens.ts` не осталось.
