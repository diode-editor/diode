# Клавиатура и терминальное окружение

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).
Оси кейбиндов (capability / tier / mode / ОС), правило одностороннего гейта по tier и гейт
досягаемости — [Commands.md](Commands.md#конвенции-системы-команд). Здесь — откуда берётся
окружение, мак-раскладка и что теряется на пути клавиши от терминала до редактора. Открытое —
[TODO/MacKeybindings.md](../../TODO/MacKeybindings.md) и
[TODO/EnvironmentTuning.md](../../TODO/EnvironmentTuning.md); пользовательский рецепт tmux —
[public/TERMINAL.md](../../public/TERMINAL.md#tmux).

## ОС клавиатуры

`env.os` — ОС клавиатуры, а не процесса: по ssh с мака раскладка маковская. Её резолвит
лестница (`resolveOs`, `terminalEnvironmentModel.ts`): настройка `keyboard.platform` →
`LC_DIODE_PLATFORM` → `LC_TERMINAL`/имя терминала (iTerm2, Apple_Terminal) → локальный `darwin` →
«не мак». Явные ступени могут сказать «не мак», остальные — только позитивные. Ответ хранится с
провенансом (`osSource`: setting / env / terminal / platform / default).

- Имя терминала без tmux приходит XTVERSION-пробой бэкенда (`probeTerminalVersion`).
- Под tmux свой `process.env` застыл на момент создания сессии, а XTVERSION ответил бы сам tmux:
  `LC_DIODE_PLATFORM`, `LC_TERMINAL` и `#{client_termtype}` спрашиваются у tmux
  (`tmuxClientProbe.ts`, `tmux show-environment`). В окружение tmux переменная попадает только с
  `set -ag update-environment LC_DIODE_PLATFORM`.
- Поздний сигнал переворачивает ОС только к маку.

## Мак-лестница

Рядом с tier — своя лестница рунгов (`platform/keybinding/common/macKeys.ts`):

| Рунг | `macKeys` | Что доступно | Когда |
| --- | --- | --- | --- |
| — | 0 | pc-раскладка | не мак |
| `legacy` | 1 | ни Ctrl+Shift, ни Cmd | Terminal.app; tmux с дефолтным `extended-keys off` |
| `extended` | 2 | Ctrl+Shift, Ctrl+Tab, Shift+Enter, но без Cmd | tmux с `extended-keys always` + `csi-u` |
| `cmd` | 3 | плюс Cmd | kitty / ghostty / iTerm2 **без** tmux |

- `cap_super` поднимается по увиденному super-биту (как `noteExtendedKeysObserved`) или форсится
  через `terminal.capabilities`.
- **Под tmux рунг не выше `extended` никогда**: у tmux три модификатора, Alt и super пишутся в один
  бит, и Cmd+S приезжает байт в байт как Option+S — Cmd-бинд выстрелил бы по команде на Alt.
- В when-клаузах — типизированные `macKeysAtLeast` / `macKeysIs` / `notMacKeys`; рунг другого
  семейства даёт ошибку типа. В `tier` мак не засовывается: «мак» не мощнее «pc».

## Мак-раскладка

- **Механическая половина — токен `mod`** (`parseKeybinding("mod+s")`): реестр разворачивает его в
  две записи — Ctrl при `!(macKeys >= 3)` и Cmd при `macKeys >= 3`. Так объявлены все бинды, у которых
  в эталоне Ctrl на Linux ↔ Cmd на маке.
- **Ручная половина — одна таблица мак-дельт** (`workbench/browser/actions/macKeybindings.ts`) по
  эталону. `withMacKeybindings` при регистрации вешает на pc-бинды из `pcOnly` условие «не мак», а
  мак-бинды регистрирует с условием «рунг ≥ from». Инварианты — `macKeybindings.test.ts`: условия
  внутри семейства взаимоисключающие во всей матрице окружений; каждая топ-команда достижима на
  `mac-legacy`; в дельтах нет `alt+<буква>` и `ctrl+←/→`; нет Cmd+C/V/X; каждый мак-бинд действует на
  своём рунге и выше.
- **WinCtrl-подслой** (⌃N/⌃P/⌃B/⌃F/⌃D…) ниже `cmd` занят фоллбэком `mod` (⌃N — New File, ⌃P —
  Quick Open), поэтому действует с рунга `cmd`; ⌃A/⌃E — исключение, с `mac-legacy` (Home/End скроллят
  буфер). Следствие: «выделить всё» на маке — только ⌘A (на `mac-legacy` — через меню или палитру).
- **Паритет с эталоном — полный и проверяемый.** Срез дефолтных биндов VS Code для Linux и macOS
  по командам diode лежит рядом с таблицей (`macKeybindings.vscodeReference.json`), и тест сверяет с
  ним независимо от таблицы: мак-бинд эталона обязан действовать на `mac-cmd`, если его pc-пара
  действует в diode на pc (чего нет и на pc — дыра pc-паритета, не мака), а мак-бинды без pc-пары —
  всегда. С новой версией VS Code срез перегенерируется, и тест покажет, что добавить.
- **Подписи на маке — глифами, как `UILabelProvider` эталона**: `⌃ ⇧ ⌥ ⌘` без разделителя в этом
  порядке, стрелки `← ↑ → ↓` (`⇧⌘P`, `⌘←`). `formatKeybinding(chord, style)` со стилем из
  `keybindingLabelStyle(contextKeys)` — меню, палитра, Keyboard Shortcuts, хинт чорда, рекордер; поиск
  во вкладке понимает и слова (`cmd+s`, `option`). Комбинации в тексте UI (плейсхолдер коммита,
  отмена удаления в корзину) строятся из действующего бинда `getKeybindingForCommand(…, overlay)`.
- **Решения человека (2026-09-26):** Cmd+C/V/X остаются эмулятору; мак-таблица — паритет с vscode,
  без приёма fresh «Ctrl+Alt вместо Ctrl+Shift»; переменная — `LC_DIODE_PLATFORM`; мост Cmd →
  F-клавиши/PUA — отдельной задачей.

## Keyboard Doctor

`workbench/contrib/keyboardDoctor/`, команда «Diode: Keyboard Doctor» (её же открывает клик по
сегменту окружения в статус-баре). По каждому нажатию пишет байты → токены → событие → бинд →
вердикт; отчёт открывается безымянным документом и копируется в буфер. Рецепты под опознанный
эмулятор — `emulatorRecipes` в модели доктора. Маппинг окружения в контекст-ключи общий с
воркбенчем (`applyTerminalEnvContextKeys`). Для разработчика то же по слоям показывает демо
`src/demos/keyDiagnosticsDemo.ts` (включает те же режимы, что бэкенд).

## Где теряется клавиша: tmux, kitty, iTerm2

- **kitty + ssh без tmux** — полный протокол (Ctrl+Tab = `\x1b[9;5u`, release-события, репорты
  модификаторов); ssh байт-прозрачен.
- **+ tmux** — модификатор гибнет на стыке kitty→tmux: tmux просит расширенные клавиши у внешнего
  терминала через xterm-`modifyOtherKeys`, а kitty его принципиально не поддерживает. tmux физически
  не получает Ctrl у Tab и добавить его не может. Лечение — в самом tmux: переработка
  [tmux#4038](https://github.com/tmux/tmux/pull/4038) и опция `extended-keys-format csi-u` вошли в
  **tmux 3.5**; на 3.4 не дожать. Рецепт — [public/TERMINAL.md](../../public/TERMINAL.md#tmux).
- **Индикатор tier ≠ доставка клавиш.** `extended-keys` поднимается и по env-хинту внешнего
  терминала (`KITTY_WINDOW_ID`), который под tmux доказательством не считается, — отсюда
  односторонний гейт по tier ([Commands.md](Commands.md#конвенции-системы-команд)). Runtime-детект —
  `TerminalEnvironmentService.noteExtendedKeysObserved()` по реально пришедшей CSI-u клавише.
- Бэкенд (`@tuidom/terminal-backend`) шлёт рядом с kitty-push ещё и `modifyOtherKeys`
  (`\x1b[>4;2m`) — для терминалов и мультиплексоров, которые его понимают. **Порядок важен:** iTerm2
  трактует любой `CSI >4;n m` как сброс kitty-стека, поэтому kitty-push идёт последним (tuidom
  [#13](https://github.com/tuidom/tuidom/pull/13)); тот же порядок повторяет `keyDiagnosticsDemo.ts`.
- **Почему не чиним кодом.** Авто-`tmux set` мутирует серверную опцию чужого tmux — отвергнуто.
  DCS passthrough для input-режимов уже был и дал утечку кодировки во все панели и сломанный
  Ctrl+S-префикс (коммит `3d20e6f`). На tmux 3.4 проблема в самом tmux. Поэтому окружение
  детектируем и подсказываем, а не подкручиваем.
- **Фолбэки без extended keys**: `Ctrl+PageDown`/`Ctrl+PageUp` (и `Alt+PageUp/Down`) переключают
  вкладки в любом tmux — модификаторы спец-клавиш кодируются стандартным `;mod`-параметром, который
  tmux пропускает всегда (`workbench/browser/actions/tabActions.ts`).
