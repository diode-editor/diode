# Интеграция с Claude Code: стоковое расширение в терминальном режиме

Статус: `[~]` — основное сделано (v0.9.7): стоковое `Anthropic.claude-code` ставится из нашего
магазина и работает в терминальном режиме — `claude` вкладкой справа, контекст (выделение, файл,
`Ctrl+Alt+K`, диагностики), предложенный дифф с ✓/↺. Решение, устройство, протокол и грабли —
[arch/StockExtensions.md](../arch/StockExtensions.md#claude-code-anthropicclaude-code-в-терминальном-режиме);
как это тестируется без настоящего CLI — [TESTING.md](../TESTING.md#тесты-на-стоковые-расширения--из-магазина-конвенция)
(«Claude Code без настоящего CLI»). Направления B и C — [VISION.md](../VISION.md).

## Осталось

- [x] **Файлы открываются в группе с `claude`.** Open File из SCM, диффы, `openFile` CLI попадали в
  активную группу — ту, где терминал `claude`. Сделана блокировка групп по эталону (#771):
  `workbench.editor.autoLockGroups.terminalEditor` запирает группу терминала, `findGroup` обходит
  запертые ([EditorPart.md](../arch/workbench/EditorPart.md#группы-редакторов)).
- [~] **Внизу открывается пустой терминал.** Расширение после диффа, `close_tab`, ✓/↺ и
  at-mention зовёт `window.activeTerminal?.show()`, чтобы вернуть фокус в `claude`. Терминал-вкладка
  у нас не становилась активной, `activeTerminal` был последним шеллом панели, и его `show()`
  раскрывал панель. Сделан активный инстанс по хостам, как в эталоне (`_hostActiveTerminals`,
  [Extensions.md](../arch/Extensions.md)).
- [ ] **`claude` в боковой панели.** `Open in Side Bar` — путь webview (`claudeVSCodeSidebarSecondary`),
  у нас молчит. У `claude-vscode.terminal.open` есть третий аргумент `"bottom"` — терминал в
  `terminal.integrated.defaultLocation`, т.е. туда, где стоит вид TERMINAL (его можно перенести во
  вторичную панель). Кандидат: своя команда «Open in Terminal (Secondary Side Bar)» + уведомление
  «в TUI недоступно» на webview-командах; решение за человеком.
- [ ] **На удалённой машине «Launching Claude Code» и тишина.** До `createTerminal` расширение ничего
  не ждёт (спиннер — таймер 2 с), значит отказ в нашем `terminal.create` после RPC: исключение
  глотается в warn канала «Extension Host (RPC)», файла лога в упакованной сборке нет. Подозрение —
  node-pty (glibc, `noexec` кэша). Разбирать на месте; в любом случае — тост об отказе создания
  терминала, `terminal.closed` расширению, внятная ошибка загрузки node-pty, warn+ в файл.
- [ ] **Webview-команды молчат.** `Open in New Window`, `Open in New Tab`, `Open in Side Bar`,
  `Alt+K` в TUI ничего не делают, след — строка в логе (`createWebviewPanel` no-op,
  `workbench.action.moveEditorToNewWindow` not found). Человеку нужно хотя бы уведомление «в TUI
  недоступно» — общее для всех расширений с webview. Нашлось, когда из палитры выбрали `Open in New
  Window` вместо `Open in Terminal`.
- [ ] **Стоковые тесты терминала** (все из Open VSX): демо-сценарий на Code Runner
  (`formulahendry.code-runner`, `runInTerminal: true`: `createTerminal`, `sendText`, `show`,
  `onDidCloseTerminal`) и direnv (`mkhl.direnv` — единственный потребитель
  `environmentVariableCollection`; нужен бинарник `direnv`); герметичный сьют на опции
  `createTerminal` по образцу Terminals Manager (`fabiospampinato.vscode-terminals`: `name`, `cwd`,
  `env`, `shellPath`, `window.terminals`, `exitStatus`). Потом — Jest Runner (переиспользование
  терминала, `processId`) и `ms-python.python` (Run Python File in Terminal, venv через коллекцию).
- [ ] **`claude` во вторичной боковой панели** — панель влита ([SecondarySideBar](SecondarySideBar.md));
  проверить вживую `claude` в терминале, перенесённом вправо: ширина, фокус, ввод, переживание
  перезапуска.
- [ ] **SVG-иконки команд** (`icon: { light, dark }` или путь к `.svg`): такой пункт `navigation`
  сейчас уходит в «⋯» — временное решение, `Claude Code: Open in Terminal` должен стать кнопкой.
  Варианты: свой глиф для известных команд, растр SVG в символ (kitty graphics / sixel — где умеет
  терминал), короткая текстовая кнопка.
- [ ] Shell integration (`onDidChangeTerminalShellIntegration`, `onDidStart…`/`onDidEnd…`) — сейчас
  no-op-события, у расширения фоллбэк на `sendText`. Link/profile-провайдеры терминала — позже.
- [ ] Снять из `support.limits` записи магазина пункт «Proposed edits are not shown as a diff tab…»
  (дифф-вкладка сделана) и сказать о ней в `works`/readme.
- [ ] Обрезка сообщений `setStatusBarMessage` в статус-баре (отложено).
- [ ] **Проверка глазами в настоящем `claude`** — за человеком (агентам запуск вложенного `claude`
  запрещён): `claude` в TERMINAL, `/ide` → Diode, выделить строки, спросить «что выделено?»;
  предложить правку и принять/отклонить дифф.
