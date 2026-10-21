# Интеграция с Claude Code: стоковое расширение в терминальном режиме

Статус: `[~]` — основное сделано (v0.9.7): стоковое `Anthropic.claude-code` ставится из нашего
магазина и работает в терминальном режиме — `claude` вкладкой справа, контекст (выделение, файл,
`Ctrl+Alt+K`, диагностики), предложенный дифф с ✓/↺. Решение, устройство, протокол и грабли —
[arch/StockExtensions.md](../arch/StockExtensions.md#claude-code-anthropicclaude-code-в-терминальном-режиме);
как это тестируется без настоящего CLI — [TESTING.md](../TESTING.md#тесты-на-стоковые-расширения--из-магазина-конвенция)
(«Claude Code без настоящего CLI»). Направления B и C — [VISION.md](../VISION.md).

## Осталось

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
