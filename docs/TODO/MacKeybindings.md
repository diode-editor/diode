# [~] MacKeybindings — мак-раскладка Diode

Цель: человек на макбуке открывает Diode в терминале (локально или по ssh на
Linux-хост) и получает раскладку, которой пользуется, не переучиваясь, а мы
получаем от него фидбек, который можно разобрать по пунктам.

Первая итерация сделана: признак `isMac` по лестнице сигналов, мак-лестница
рунгов с `cap_super`, токен `mod`, таблица мак-дельт для топ-команд, Keyboard
Doctor. Ниже — как это устроено, протокол фидбека и что осталось.

## Как устроено

- **ОС клавиатуры, а не процесса.** `env.os` резолвится лестницей
  (`resolveOs`, `terminalEnvironmentModel.ts`): настройка `keyboard.platform` →
  `LC_DIODE_PLATFORM` → `LC_TERMINAL`/имя терминала (iTerm2, Apple_Terminal) →
  локальный `darwin` → «не мак». Явные ступени могут сказать «не мак», остальные
  только позитивные. Ответ хранится с провенансом (`osSource`: setting / env /
  terminal / platform / default). Под tmux свой `process.env` не читается:
  `LC_DIODE_PLATFORM`, `LC_TERMINAL` и `#{client_termtype}` спрашиваются у tmux
  (`tmuxClientProbe.ts`). Поздний сигнал переворачивает ОС только к маку.
- **Мак-лестница рядом с tier** (`platform/keybinding/common/macKeys.ts`):

  | Рунг | `macKeys` | Что доступно | Когда |
  | --- | --- | --- | --- |
  | — | 0 | pc-раскладка | не мак |
  | `legacy` | 1 | ни Ctrl+Shift, ни Cmd | Terminal.app; tmux с дефолтным `extended-keys off` |
  | `extended` | 2 | Ctrl+Shift, Ctrl+Tab, Shift+Enter, но без Cmd | tmux с `extended-keys always` + `csi-u` |
  | `cmd` | 3 | плюс Cmd | kitty / ghostty / iTerm2 **без** tmux |

  `cap_super` поднимается по увиденному super-биту (как `noteExtendedKeysObserved`)
  или форсится через `terminal.capabilities`. Под tmux рунг не выше `extended`
  никогда: tmux пишет Alt и super в один бит, и Cmd-бинд выстрелил бы по команде
  на Alt. В when-клаузах — типизированные `macKeysAtLeast` / `macKeysIs` /
  `notMacKeys`, рунг другого семейства даёт ошибку типа.
- **Механическая половина — токен `mod`** (`parseKeybinding("mod+s")`):
  реестр разворачивает его в две записи, Ctrl при `macKeys < 3` и Cmd при
  `macKeys >= 3`.
- **Ручная половина — таблица мак-дельт** (`workbench/browser/actions/macKeybindings.ts`),
  одна на всё, по эталону vscode. `withMacKeybindings` при регистрации вешает
  на pc-бинды из `pcOnly` условие «не мак», а мак-бинды регистрирует с
  условием «рунг ≥ from». Инварианты закрыты тестом `macKeybindings.test.ts`:
  условия внутри семейства взаимоисключающие во всей матрице окружений; каждая
  топ-команда достижима на `mac-legacy`; в дельтах нет `alt+<буква>` и
  `ctrl+←/→`; нет Cmd+C/V/X.
- **Keyboard Doctor** (`workbench/contrib/keyboardDoctor/`): команда
  «Diode: Keyboard Doctor». Её же открывает клик по сегменту окружения в
  статус-баре. Доктор ведёт по проверкам протокола ниже и по каждому нажатию
  пишет байты → токены → событие → бинд → вердикт. Отчёт открывается безымянным
  документом и копируется в буфер.

Решения человека (2026-09-26): Cmd+C/V/X остаются эмулятору; мак-таблица —
паритет с vscode, без приёма fresh «Ctrl+Alt вместо Ctrl+Shift»; переменная —
`LC_DIODE_PLATFORM`; мост Cmd → F-клавиши/PUA — отдельной задачей.

Следствие паритета: на маке Ctrl+A — начало строки, поэтому «выделить всё»
доступно только через Cmd+A (на `mac-legacy` — через меню или палитру).

## Протокол фидбека от маковода

Его ведёт Keyboard Doctor, человеку остаётся нажимать и прислать отчёт.

- **До нажатий** в шапке отчёта: ОС и её источник, tier, рунг, caps, моды,
  терминал. Под tmux дополнительно попросить
  `tmux show-options -g extended-keys extended-keys-format` и
  `tmux display -p '#{client_termfeatures}'`.
- **Форма по каждой проверке:** нажал → ожидал → получил (байты) → сработала
  команда (да / другая / никакая).
- **Проверки по порядку:** базовый набор (сохранить, палитра, quick open, find);
  Option+← (Option как Alt); Option+A (пришло å?); Option+буква,
  дающая `@ [ ] { }` на его раскладке; Home в длинной строке (скроллится буфер?);
  Ctrl+← (Mission Control); Ctrl+Shift+E/M (caron?); Ctrl+Tab с удержанием
  (keyup); на `mac-cmd` — Cmd+S, Cmd+P, Cmd+↑, Cmd+Backspace; под tmux — Cmd+S
  (должен прийти как Alt+S и ничего не исполнить).
- **Не просить нажимать** Cmd+Q, Cmd+W, Cmd+H, префикс tmux и Ctrl+C/D/Z вне
  редактора — о них спрашивать словами.
- «Ничего не пришло» — валидный ответ, в докторе это Escape.
- Итоговая матрица: эмулятор × (tmux / без tmux), что реально приезжает, с
  байтами. Именно она закрывает «не проверено» в таблице эмуляторов.

## Не проверено на живом маке

Рецепты эмуляторов (`emulatorRecipes` в модели доктора) взяты из документации и
issue, а не из замеров. Расхождение с живым маком — ценный результат: правим
рецепт и таблицу.

| Эмулятор | Cmd | Что нужно от пользователя |
| --- | --- | --- |
| Terminal.app | невозможен | Kitty-протокола нет; Option — «Use Option as Meta key» |
| iTerm2 | да, с настройкой | Left/Right Command = Super + «Apps can change how keys are reported» |
| kitty / ghostty / WezTerm | да | снять свои Cmd-шорткаты; Option as Alt только левый; ghostty — `alt+arrow_*=unbind` |
| macOS | — | Cmd+Tab/Space/H до эмулятора не доходят; Ctrl+←/→ забирает Mission Control |

## Осталось

- [ ] **XTVERSION-проба.** Нужен `ITerminalBackend.probeTerminalVersion`
  (tuidom PR [#15](https://github.com/tuidom/tuidom/pull/15)). После выхода версии
  `detect()` зовёт её и отдаёт ответ в `noteTerminalName`. Под tmux на неё отвечает
  сам tmux, поэтому там остаётся канал `client_termtype`.
- [ ] **Тесты и сценарий на Cmd+буква.** `serializeKey("Meta+s")` в
  `@tuidom/core` сейчас бросает (tuidom PR [#12](https://github.com/tuidom/tuidom/pull/12)).
  До выхода версии сценарий `macKeybindings.scenario.ts` ходит только по
  именованным клавишам (`Meta+ArrowUp` и т.п.). После выхода добавить Cmd+S / Cmd+P.
- [ ] **iTerm2 и порядок режимов.** Бэкенд шлёт `CSI >4;2m` после kitty-push, и
  iTerm2 сбрасывает kitty-стек (tuidom PR [#13](https://github.com/tuidom/tuidom/pull/13)).
  Тот же порядок повторяет `src/demos/keyDiagnosticsDemo.ts` — поправить вместе с
  обновлением пакета.
- [ ] **Полный паритет с мак-раскладкой vscode.** Первая итерация закрывает топ-команды,
  остальные ~150 биндов на маке остаются Ctrl-шными. Следующие шаги: перевести
  `KeyMod.CtrlCmd`-бинды на `mod` и сверить остальные `mac:`-оверрайды эталона.
  Особые случаи:
  - остаток WinCtrl-подслоя (Ctrl+B/F/P/N/D/H/O/K) на `mac-legacy` конфликтует с
    `mod`-фоллбэками, пока Cmd не доезжает. Сюда же входят Select-варианты
    `cursorLineStart/End`: Ctrl+Shift+A/E на `mac-extended` сталкиваются с Ctrl+Shift+E
    (Explorer);
  - команд Save All и Replace в diode нет, их бинды появятся вместе с командами;
  - Cmd+Shift+]/[ для вкладок не проверены: как kitty репортит Shift+] (`]` или `}`),
    покажет доктор.
- [ ] **Отображение комбинаций на маке.** Меню и вкладка шорткатов пишут `Meta+S`;
  маководу привычнее `Cmd+S` / `⌘S`.
- [ ] **Мост Cmd → Shift+F1…F12 / PUA-кодпоинт для жителей tmux** — отдельная задача
  (решение человека). Каналы проверены: `\x1b[1;2P` у нас разбирается как Shift+F1,
  tmux знает kf13..kf24 и передаёт их; неизвестный csi-u кодпоинт tmux форвардит
  литералом. Литеральный PUA-символ сейчас становится F-клавишей
  (tuidom issue [#14](https://github.com/tuidom/tuidom/issues/14)), поэтому кодпоинты
  брать от `U+E800`.
- [ ] **Квиз-визард** поверх доктора (отложен): его ответ — ещё один источник
  провенанса `osSource`.
- [ ] **Флаги Kitty-протокола настройкой** (`CSI > 15u` вкомпилирован в бэкенд;
  у fresh — четыре флага настройками). Только после замера: `report_event_types`
  нужен hold-сессиям.
