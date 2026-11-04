# Клавиатура и терминальное окружение

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).
Оси кейбиндов (capability / tier / mode / ОС), правило одностороннего гейта по tier и гейт
досягаемости — [Commands.md](Commands.md#конвенции-системы-команд). Здесь — откуда берётся
окружение, мак-раскладка и что теряется на пути клавиши от терминала до редактора. Открытое —
[TODO/MacKeybindings.md](../../TODO/MacKeybindings.md) и
[TODO/EnvironmentTuning.md](../../TODO/EnvironmentTuning.md); пользовательский рецепт tmux —
[public/TERMINAL.md](../../public/TERMINAL.md#tmux).

## Tier выбирается на старте и дальше не меняется (#1049)

Решение человека 2026-11-03: «auto = legacy всегда; расширенный режим только явной настройкой,
diode лишь показывает, что он доступен». Иначе сочетания зависели от терминала и менялись посреди
сессии (#907: Ctrl+S переставал сохранять после первого Cmd).

Решение человека 2026-11-04: «дефолт, который был в начале, лучше — с деградацией», но починку
#1049 не откатывать. Поэтому `auto` снова включает расширенные клавиши сам, когда терминал их
подтвердил, но один раз на старте и без подъёма по пришедшим клавишам; `legacy` ведёт себя как
`auto` из #1049.

- Протоколы клавиш (kitty-push `CSI > 15 u` и `modifyOtherKeys` `CSI > 4 ; 2 m`) включаются с
  первого байта только явной настройкой: `terminal.tier` `csi-u`/`kitty` или `auto` +
  `terminal.capabilities["extended-keys"]: true` (`extendedKeysAtStartup`). `main.ts` передаёт ответ
  в `NodeTerminalBackend({ extendedKeys })`; без него движок не шлёт ни того, ни другого и на выходе
  ничего не сбрасывает. Позже включить может только сервис (`enableExtendedKeys()` движка, если бэкенд —
  `NodeTerminalBackend`).
- **`auto` деградирует.** Старт в legacy; подтверждение терминала включает протоколы один раз:
  без tmux — ответ на `CSI ? u` (tier по `resolveTier`: `kitty`/`csi-u`, `cap_super` поднят, на маке
  рунг `cmd`; XTVERSION уходит раньше, так что имя мак-терминала к этому моменту известно), под tmux —
  `detectTmuxClient` (ниже) → `csi-u`. Нет подтверждения — legacy до конца сессии. `auto` с
  `terminal.capabilities["extended-keys"]` (`true` или `false`) — явное слово, автовключения нет.
- После этого tier не меняется: подъёма по env-хинту и пришедшей клавише нет. Смена `terminal.tier`/`terminal.capabilities` в живой
  сессии даёт уведомление «Restart Diode to apply …».
- При `legacy` (и `extended-keys: false`) пробы только узнают, что **доступно** (`availableTier`, сегмент `legacy · kitty available`): без
  tmux — ответ на `CSI ? u` → `kitty`; под tmux пробы не шлются (ответил бы tmux или никто), а
  `detectTmuxClient` спрашивает сам tmux одним `display-message`: опция `#{extended-keys}` не `off`
  и `extkeys` в `#{client_termfeatures}` → `csi-u`. Когда протоколы уже включены, «available» не
  показывается. Смена настройки предлагает «Reload Window» — перезапуск процесса на месте.

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

- `cap_super` поднимается ответом на `CSI ? u` при включённых протоколах вне tmux (мак-исключение
  или явный tier) или форсится через `terminal.capabilities`.
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

## Сегмент окружения в статус-баре

`TerminalEnvStatusContribution` показывает tier, мак-рунг, моды и в конце доступное сверх
включённого (`legacy · tmux · csi-u available`); клик открывает пользовательский
`settings.json` (`workbench.action.openSettingsJson` с `revealSetting: terminal.tier` — аргумент
принимается, Settings UI нет). Для разработчика путь клавиши по слоям показывает демо
`src/demos/keyDiagnosticsDemo.ts` (включает те же режимы, что бэкенд). Мастер настройки клавиатуры —
будущая задача (заменит удалённого в #1047 доктора).

## Где теряется клавиша: tmux, kitty, iTerm2

- **kitty + ssh без tmux** — полный протокол (Ctrl+Tab = `\x1b[9;5u`, release-события, репорты
  модификаторов); ssh байт-прозрачен.
- **+ tmux** — модификатор гибнет на стыке kitty→tmux: tmux просит расширенные клавиши у внешнего
  терминала через xterm-`modifyOtherKeys`, а kitty его принципиально не поддерживает. tmux физически
  не получает Ctrl у Tab и добавить его не может. Лечение — в самом tmux: переработка
  [tmux#4038](https://github.com/tmux/tmux/pull/4038) и опция `extended-keys-format csi-u` вошли в
  **tmux 3.5**; на 3.4 не дожать. Рецепт — [public/TERMINAL.md](../../public/TERMINAL.md#tmux).
- **Два формата расширенных клавиш tmux.** `extended-keys-format csi-u` (tmux ≥ 3.5) шлёт
  `\x1b[1092;5u`, формат `xterm` (дефолт на 3.5+, единственный на 3.4) — modifyOtherKeys
  `\x1b[27;5;1092~`. Движок с 0.30.1 разбирает второй в то же событие, что первый: тот же `key`,
  `code` и модификаторы (раньше печатные клавиши в нём выбрасывались, #1048).
- **Нелатинская раскладка — по физической клавише**, как `keyboard.dispatch: code` в VS Code на Linux
  (`matchesBinding` в `keybindingRegistry.ts`). Бинд на букву с Ctrl/Cmd матчится по `code`
  (Ctrl+ы → Ctrl+S), с Alt — только для нелатинского символа (мнемоники меню). Бинд на знак
  `` [ ] ; ' , . / \ ` - = `` — только для нелатинского символа (≥ U+0080) с Ctrl, Cmd или Alt:
  Ctrl+Shift+Х → Ctrl+Shift+[, Ctrl+Ё → `` Ctrl+` ``. Латинский символ решает сам: в русской раскладке
  на физическом `/` печатается `.`, и это Ctrl+., а не Ctrl+/.
- **Индикатор tier ≠ доставка клавиш.** Явный `csi-u`/`kitty` в терминале без протокола (или tmux
  с `extended-keys off`) клавиши не доставит — отсюда односторонний гейт по tier
  ([Commands.md](Commands.md#конвенции-системы-команд)). Обратное тоже бывает: tmux с
  `extended-keys always` шлёт CSI-u и в legacy — парсер их разбирает, tier от этого не меняется.
- Бэкенд (`@tuidom/terminal-backend`), когда протоколы включены, шлёт рядом с kitty-push ещё и `modifyOtherKeys`
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
