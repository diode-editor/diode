# Integrated Terminal — открытое

Статус: `[~]` — терминал интегрирован (панель TERMINAL, несколько терминалов, терминал вкладкой
редактора, терминалы расширений и задач, тема-реактивная палитра, SEA-упаковка node-pty); устройство —
[arch/workbench/Terminal.md](../arch/workbench/Terminal.md). Ниже — только открытое.

## Кросс-платформенность

Интеграция и упаковка проверены **только на linux-x64**; сборка на всех трёх ОС проходит, но живой шелл
на macOS/Windows не проверялся (e2e-сценарий там пропускается).

- [ ] **CI-матрица `ubuntu/macos/windows`**: сборка SEA + прогон headless-харнесса (PTY-харнесс на
  `AnsiScreen` переносится один-в-один на `macos-latest`/`windows-latest`); на macOS — распакованный
  `pty.node` под Gatekeeper; на Windows — resize-путь ConPTY (инъекции очищающих последовательностей,
  `onExit` может не срабатывать, иной kill — `e2e/helpers/runDiode.ts`), Backspace `\x7f` vs `\b` на cmd.
- [ ] Дефолтный шелл Windows: обнаружение PowerShell, как у upstream (сейчас `%COMSPEC%` → `cmd.exe`,
  `base/node/shell.ts`).
- [ ] **Неудавшийся спавн шелла прилетает наружу необработанной ошибкой.** На Windows клик по вкладке
  TERMINAL валит спавн PTY, и `File not found: ` уходит наружу через RPC инспектора, а не гасится в
  `TerminalService`: пользователь неподдерживаемой платформы увидит падение действия, а не «терминал
  недоступен». Нашлось в #197 (тест перевели на вкладку PROBLEMS, `e2e/outputPanel.test.ts`).

## UX

- [ ] Скролбэк колесом в e2e: инспектор-протокол пока не инъецирует колесо (enabler `TUIDom.sendMouse`),
  сценарий `terminalScrollback` крутит вьюпорт клавиатурой. Выделение и копирование, bracketed-paste.
- [x] Ссылки на файлы: Ctrl+наведение подчёркивает, Ctrl+клик открывает (#816,
  [Terminal.md](../arch/workbench/Terminal.md#ссылки-на-файлы)). Дальше — quick pick «Open Detected Link…»,
  URL и word-ссылки.
- [ ] **Сплиты терминалов** (`split`/`splitActiveTab`/`unsplit`, группы), с ними — `hideCondition:
  singleGroup` по группам и префиксы `┌ ├ └` в списке.
- [ ] **Rename терминала** (`rename`, `renameActiveTab` — F2 в списке) и `tabs.title`/`description`/
  `separator` с `${process}`, `${cwdFolder}` (нужен трекинг процесса и cwd).
- [ ] Иконки и цвета вкладок (`tabs.defaultIcon`, `tabs.defaultColor`, Change Icon/Color), статусы
  вкладок (`tabs.enableAnimation`).
- [ ] Ширина списка вкладок: sash и узкий режим (`singleTerminalOrNarrow`), `tabs.showActions`.
- [ ] Мышь в списке вкладок: средний клик — kill, мультивыделение, drag-and-drop.
- [ ] Остальная цветовая механика xterm.js: `terminal.integrated.minimumContrastRatio` (дефолт 4.5),
  `drawBoldTextInBrightColors`, `terminalCursor.*`, `terminal.selectionBackground`.
- [ ] Проброс клавиш à la `terminal.integrated.commandsToSkipShell`: список команд, которые перехватывает
  редактор (сейчас фокус в терминале съедает почти весь ввод).
- [ ] Не покрыто автоматизацией: живой Ctrl+`` ` `` на tier kitty/csi-u.
