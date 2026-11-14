# Отладчик (DAP) — заметки и спайк видов

Статус: исследование + спайк UI на ветке `spike/debug-views` (не для влития). Здесь всё, что выяснили
к 2026-11-13, чтобы продолжить с любой машины.

## Где мы сейчас

- `vscode.debug` поднят целиком (18/18), но это null-объект (`src/vs/workbench/api/common/debugNoop.ts`):
  сессии не стартуют, `onDebug*` не стреляют.
- **Противоречие в доках:** [docs/arch/Extensions.md](../arch/Extensions.md) («Отладка как null-объект») пишет «DAP не
  планируется (решение человека)», а `GOAL.md` и `docs/public/STATUS.md` — «направление на потом / planned».
  Если берёмся — поправить формулировку в Extensions.md.

## Оценка объёма (эталон vscode 1.127, `contrib/debug`)

| слой | строк | переносимость |
|---|---|---|
| `common/` (модель, сессии, брейкпоинты, `debugProtocol.d.ts`) | ~9.5k | в основном переносится: логика без DOM; `debugProtocol.d.ts` — дословно, остальное адаптировать под наш DI/события |
| `browser/` (виды, редактор, REPL, тулбар) | ~26k | не переносится — DOM; переписываем на tuidom, копируя поведение (как Testing) |
| ext host (`extHostDebugService` + `mainThreadDebugService`) | ~1.8k | переносится, по образцу `extHostTesting` |

Прецедент: Testing — эталон 21.5k строк, у нас 5.4k, 9 PR за 5 дней. Отладчик — примерно 2–3× Testing:
**~15–25 PR, 2–3 недели темпом лупа**.

Что уже есть и переиспользуется: глифы в гаттере и бейджи после строки (Testing), hover, деревья/списки,
терминал (reverse request `runInTerminal`), задачи (`preLaunchTask`), quick input.

Пропускаем: Disassembly, Memory (webview — невозможно), Loaded Scripts.

Риск TUI: эмуляторы терминала перехватывают F10 (меню) и F11 (fullscreen) — нужны запасные сочетания.

## Фазы (предложение)

1. Ядро DAP (модель + сессия + адаптер-процесс через `GuardedChildProcess`) + `launch.json`
   (`${workspaceFolder}`, `preLaunchTask`), брейкпоинты в гаттере, текущая строка, F5/F10/F11,
   Call Stack + Variables. ~6–8 PR.
2. Watch, Breakpoints-вид, hover, условные брейкпоинты/logpoints, Debug Console. ~6–8 PR.
3. Настоящий `vscode.debug` (`contributes.debuggers`/`breakpoints`, фабрики дескрипторов
   Executable/Server/NamedPipe/Inline, провайдеры конфигураций, трекеры, `onDebug*`). ~4–6 PR.
   Фазу 3 можно поднять раньше, если важнее экосистема расширений, чем быстрый C/C++.

Для тестов и демо до gdb/lldb — `microsoft/vscode-mock-debug` (маленький DAP-адаптер, «отлаживает»
текстовый файл).

## C/C++: чем отлаживать

- **clangd** (`llvm-vs-code-extensions.vscode-clangd` 0.6.0) — только язык: `contributes` без `debuggers`,
  активация только `onLanguage:*`. Отладчика в нём нет.
- **cpptools (Microsoft)** — нет в Open VSX, и лицензия запрещает использование вне продуктов Microsoft. Не вариант.
- Open VSX на 2026-11-12:

| расширение | загрузок | лицензия | устройство |
|---|---|---|---|
| `vadimcn/vscode-lldb` (CodeLLDB) 1.12.3 | 1.4M | MIT | свой адаптер (Rust) + LLDB внутри, платформенные vsix; C/C++ и Rust |
| `eclipse-cdt/cdt-gdb-vscode` 3.0.0 | 1.0M | EPL | Node-адаптер поверх gdb/MI (Eclipse Theia) |
| `KylinIdeTeam/cppdebug` 0.4.0 | 500k | не проверяли | похоже, отладочная часть cpptools (открытый MIEngine) |
| `llvm-vs-code-extensions/lldb-dap` | 194k | Apache 2.0 + LLVM | официальный LLVM, бинарь `lldb-dap` из системы |
| `webfreak/debug` (Native Debug) 0.27.0 | 103k | public domain | gdb/lldb через MI, заброшен с 2024-02 |

- **Решение: целевое расширение — CodeLLDB** (самое популярное, без системных зависимостей, gcc-бинари через
  DWARF понимает, Rust бонусом, путь эталона — отладчик из расширения). Запасной — `cdt-gdb-vscode`.
- Встроенный `gdb -i=dap` (gdb ≥ 14; на машине разработки стоит 17.1) — отступление от эталона (в vscode нет
  встроенного типа), в основу не берём.
- **Не проверено:** какие API трогает CodeLLDB (чем отдаёт адаптер — Executable/Server/Inline, что ещё зовёт).
  Это первый шаг перед фазой 3.

## Спайк видов (`spike/debug-views`)

Цель — посмотреть и потюнить виды до настоящего DAP. Виды читают только стаб-модель, по форме повторяющую
`debugModel.ts` эталона, — настоящая сессия встанет на её место без переделки видов.

Запуск: в checkout'е ветки `npm start` → `Ctrl+Shift+D` → **F5**.
F10/F11/Shift+F11 — шаги, F5 — continue, F6 — pause, Shift+F5 — stop, Ctrl+Shift+F5 — restart,
`Ctrl+Shift+Y` — Debug Console. Третий F10 — остановка по исключению.

Файлы:
- `src/vs/workbench/contrib/debug/common/debugStubModel.ts` — фейковая сессия: потоки/кадры/скоупы/переменные
  с ленивыми детьми (задержка 250 мс), куски `[0..99]` для вектора на 1000, отметка изменений между
  остановками, watch-вычисления, брейкпоинты, REPL. Контекст-ключи `debugState`, `inDebugMode`.
- `browser/debugTreeList.ts` — ленивое дерево поверх `ListViewElement` (свёрнутый узел держит дочернюю строку
  «Loading...», раскрытие перечитывает дерево, перестройка одним махом с сохранением курсора и скролла,
  `stickToBottom` для REPL).
- `browser/debugRows.ts` — строки из цветных спанов; цвета значений как `renderExpressionValue`.
- `browser/debugViews.ts` — контейнер `workbench.view.debug` (RUN AND DEBUG): VARIABLES, WATCH, CALL STACK,
  BREAKPOINTS.
- `browser/replView.ts` — панель `workbench.panel.repl` (DEBUG CONSOLE): дерево вывода + строка ввода.
- `browser/debugActions.ts` — команды с id эталона; в заголовке вьюлета осталась только Start Debugging.
- `browser/debugToolbar.ts` — тулбар отладки в области редактора (решение человека, 2026-11-14): на месте find-виджета,
  сверху справа активной группы, в той же рамке `editorWidget`; кнопки с подписями (`▶ Continue ↷ Over ↓ Into ↑ Out
  ↻ Restart ■ Stop`), в узкой группе — только глифы. С открытым find встают стопкой: тулбар сверху, find под ним
  (`FindComponent.setTopInset`). Отступление: у эталона тулбар плавает по центру над всем окном.
- Кнопка «Run and Debug» пустого состояния — на всю ширину, как Commit у Source Control (`ScmActionButtonElement`);
  у строк всех видов отступ в колонку слева и справа.
- `src/vs/platform/theme/common/colors/debugColors.ts` — токены цветов эталона.
- Подключение: `workbenchModule.ts`, `workbench.common.main.ts` (помечено `SPIKE`).

### Выводы спайка

- **REPL не страшный.** Все пять видов, включая REPL, стоят на одном помощнике (~150 строк). Объекты в консоли —
  те же раскрывающиеся значения, что в Variables (в эталоне REPL — тоже дерево, `replViewer.ts`).
- **`TreeViewElement` не годится** — одна раскраска на метку; нужен `ListViewElement` со строками-спанами.
  Вопрос на потом: вынести «ленивое дерево с богатыми строками» в tuidom или в `browser/parts/views/`.
- **Узкий сайдбар.** У эталона `file line:col` прижаты вправо и в ~28 колонках съедали имя функции; в спайке
  место вызова идёт сразу за именем и обрезается первым (отступление).
- Найденный и исправленный баг помощника: повторное раскрытие узла после Collapse All оставляло «Loading...» —
  раскрытие должно всегда перечитывать детей.

### Что доделать / потюнить

- [ ] Посмотреть глазами и потюнить: длительность подсветки изменений (1 с без анимации легко пропустить),
      показ условия брейкпоинта (эталон — только в hover, у нас курсивом в строке), метки состояний потоков,
      маркер `➜` текущего кадра, ширина/отступы строк.
- [ ] Перенос длинных строк в Debug Console (сейчас обрезаются; у `ListViewElement` есть многострочные строки
      `height`).
- [ ] ANSI-цвета в выводе консоли (`debugANSIHandling.ts` эталона).
- [ ] Автодополнение в строке ввода REPL (у эталона там редактор с suggest); многострочный ввод.
- [ ] Фильтр консоли в заголовке (эталон: «Filter (e.g. text, !exclude)»).
- [ ] Контекстные меню: Copy Value, Copy as Expression, Set Value (F2), Add to Watch, Break on Value Change;
      Edit Condition у брейкпоинта.
- [ ] Inline-редактирование watch-выражения (сейчас добавление через quick input).
- [ ] Тулбар: стоит в активной группе и переезжает за ней — проверить, не раздражает ли; ширину выровнять с find;
      цвет статус-бара во время отладки (`statusBar.debuggingBackground`).
- [ ] `ScmActionButtonElement` переиспользован из `contrib/scm` — для влития вынести общую кнопку в `browser/parts/views/`.
- [ ] Выпадающий выбор конфигурации запуска в заголовке Run and Debug (эталон: ▷ + список `launch.json`).
- [ ] Редактор (вне этого спайка): глифы брейкпоинтов в гаттере, подсветка текущей строки
      (`editor.stackFrameHighlightBackground`), hover значений, inline values.
- [ ] После тюнинга — скиллом `spec` нарезать фазы 1–3 на issues для лупа; поправить противоречие в
      Extensions.md.
