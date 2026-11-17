# Отладчик (DAP) — заметки и спайк видов

Статус: в работе у агентского лупа — эпик [#1132](https://github.com/diode-editor/diode/issues/1132) (решения
человека, правила серии, список задач). Спайк UI — ветка `spike/debug-views` (не для влития). Ниже — исследование,
из которого выросла серия.

## Серия issues (2026-11-14)

- Веха 1 — C/C++ через CodeLLDB и выпуск minor: #1133 `vscode.lm` null-объект, #1134 `installFromVSIX`,
  #1135 модель и протокол, #1136 сессия и команды, #1137 резолвер переменных, #1138 `launch.json`,
  #1139–#1141 `vscode.debug` (провайдеры, адаптеры, сессии), #1142 `runInTerminal`, #1143 контрол дерева,
  #1144–#1146 виды и консоль, #1147 тулбар и статус-бар, #1148 гаттер и текущий кадр, #1149 приёмка CodeLLDB.
- Веха 2 — полнота по эталону: #1150–#1158 (консоль, виды брейкпоинтов, hover, inline values, команды редактора,
  меню `debug/*`, запуск, IntelliSense `launch.json`, добивка настроек и API).
- Веха 3 — Node через js-debug: #1159 дочерние сессии, #1160 терминальные профили, #1161 приёмка js-debug,
  #1162 Debug-профиль в Testing.
- Находки, которые не следовали из эталона: CodeLLDB падает на `vscode.lm.registerTool` (у нас нет `lm`); ставит
  свой платформенный пакет командой `workbench.extensions.command.installFromVSIX`; адаптер отдаёт как
  `DebugAdapterInlineImplementation` поверх обратного TCP; у нас нет `${command:}`/`${input:}`, клика по пустому
  гаттеру и подсветки строки токеном темы.

## Где мы сейчас

- #1135: `src/vs/workbench/contrib/debug/common/` — модель эталона (`debugModel.ts`: выражения и переменные с ленивыми
  детьми и кусками `[0..99]`, кадры, потоки, скоупы, брейкпоинты всех видов, watch), `debugViewModel.ts`,
  `debugSource.ts`, `debugUtils.ts`, `breakpoints.ts`, `debugStorage.ts` (ключи эталона в scope `workspace` у
  `IStateService`), `debugProtocol.d.ts` дословно, контекст-ключи `CONTEXT_*` в `ContextKeyTypes`, цвета — в
  `platform/theme/common/colors/debugColors.ts`. Модель 1-based, как DAP и эталон (`editor/common/core/range.ts`);
  ±1 — на стыке с редактором. Отступления записаны в шапке каждого файла: нет `IUriIdentityService`, `ITextFileService`
  сужен до `ITextFileDirtyState`, хранилище без observables (перечитывается на `onDidOpenWorkspace`), нет памяти,
  визуализаторов и дизассемблера; `openInEditor`, `IDebugService`, `ILaunch`, `convertToDAPaths` и прочее приходят
  со своими задачами серии.
- #1136: сессия и сервис. `common/abstractDebugAdapter.ts` (DAP-обмен: номера, таймауты, очередь сообщений по задаче на
  сообщение), `common/replModel.ts` (модель Debug Console с ключами `debug.console.collapseIdenticalLines` и
  `debug.console.maximumLines`; вид — #1146), `common/debugger.ts`; в `browser/` — `rawDebugSession.ts`,
  `debugSession.ts` (+ `ThreadStatusScheduler`), `debugService.ts` (`DebugServiceDIToken`, порты — `IDebugServicePorts`,
  контрибуция фазы `afterRestored`), `debugAdapterManager.ts`, `debugCommands.ts` (`DEBUG_ACTIONS`: id, клавиши и
  палитра эталона; F6 паузы — вес выше «Notifications: Focus Message»). **Шов для адаптеров расширений** —
  `debugService.getAdapterManager()`: `registerDebugger(contribution)` (тип отладчика, вместо точки расширения
  `debuggers` эталона — её позовёт #1139) и `registerDebugAdapterFactory(types, factory)` (адаптер — #1140).
  `startDebugging` идёт по последовательности эталона; шаги будущих задач (провайдеры, `launch.json`, задачи, выбор
  отладчика без `type`) там — тождество с комментарием. **Синтетический адаптер** — `src/TestUtils/syntheticDebugAdapter.ts`
  (`registerSyntheticDebugger`, тип `synthetic`, данные спайка, `SPIKE_TIMING`/`NO_DELAY_TIMING`); на нём
  `debug.app.test.ts` гоняет весь workbench: `debug.startFromConfig`, `debugState`, клавиши.
- #1144: вьюлет Run and Debug (`browser/debugViewlet.ts`, `DebugViewletComponentDIToken`; контейнер `workbench.view.debug`
  между Source Control и Extensions, `Ctrl+Shift+D` и досягаемый везде `Ctrl+K B`). Без сессии VARIABLES показывает
  welcome эталона: кнопка «Run and Debug» на всю ширину — общая `ActionButtonElement`
  (`browser/parts/views/actionButtonElement.ts`, та же у Commit в Source Control) — и подсказка про launch.json.
  `variablesView.ts` — скоупы фокус-кадра (первый недорогой раскрыт, обновление через 400 мс при шагах и сразу при
  явном выборе кадра), ленивые переменные — Enter по строке с глазом; `watchExpressionsView.ts` — выражения
  воркспейса в фокус-кадре, ввод выражения — quick input (отступление: у эталона поле на строке), Escape/пусто
  убирает новую строку. Строки рисует `debugExpressionRenderer.ts` (`name: value`, цвета `debugTokenExpression.*`,
  подсветка изменённого значения на 1 с). Команды — `debugViewActions.ts` (входят в `DEBUG_ACTIONS`). Настройки
  `debug.showVariableTypes`, `debug.openDebug` (порт `openViewlet` у сервиса и сессии), `debug.autoExpandLazyVariables`
  (`auto` = выключено: нет режима скринридера). Живой сессии в бинаре пока нет (адаптеры расширений — #1139/#1140):
  виды остановки проверяет `debugViewlet.app.test.ts` на синтетике, сценарий `run-and-debug` — пустое состояние.
- #1145: CALL STACK (`browser/callStackView.ts`, `CallStackDataSource` эталона: сессии — только при нескольких, потоки —
  только при нескольких, метка состояния справа цветами `debugView.stateLabel*`/`exceptionLabel*`; состояние
  единственного потока — в описании заголовка вида; 20 кадров и «Load N More Stack Frames», подряд идущие
  `subtle`/`deemphasize` — «Show N More Stack Frames»). Кадр — «имя, затем `файл:строка` приглушённо» и стрелка
  глиф-поля редактора перед верхним кадром фокус-потока и фокус-кадром; курсор на кадре — фокус (VARIABLES и WATCH
  следуют), открытие кадра в редакторе — #1148. BREAKPOINTS (`browser/breakpointsView.ts`): фильтры исключений
  сессии, функции, data, исходники, инструкции; чекбокс `[✓]` кликается, иконки `getBreakpointIcon` (выбор иконки
  `getBreakpointMessageAndIcon` без сообщения — у строк нет ховера) цветами `debugIcon.breakpoint*`; условие и
  log-сообщение курсивом в строке; `debug.breakpointsView.presentation: tree` — группы по файлу с трёхпозиционным
  чекбоксом, строки читают исходник (`breakpointSources.ts`, с диска). Space/Delete/Enter/Ctrl+Enter и команды
  заголовка — `debugViewActions.ts`; правка брейкпоинтов в `DebugService` (`enableOrDisableBreakpoints`,
  `removeBreakpoints`, `setBreakpointsActivated`, функции/data/инструкции) перенесена дословно. Синтетика теперь
  поддерживает function/data/instruction брейкпоинты, не верифицирует брейкпоинты вне программы и называет
  `hitBreakpointIds` остановки. Проверка — `callStackView.app.test.ts`, `breakpointsView.app.test.ts`; сценарий
  `breakpoints` — функциональный брейкпоинт без сессии (живой сессии в бинаре всё ещё нет).
- #1146: Debug Console (`browser/repl.ts`, `ReplDIToken`; контейнер панели `workbench.panel.repl` между Output и
  Terminal, вид `workbench.panel.repl.view`). Дерево консоли показанной сессии на `LazyTreeControl` (`stickyTail`,
  правая часть строки `renderRowEnd` — источник `файл:строка` и бейдж повторов `badge.*`), объекты результатов и
  `variablesReference` раскрываются на месте. Ввод: Enter — `evaluate` (`repl`) в фокус-кадре, ↑/↓ — история
  (`debug.repl.history`, 100 на воркспейс), Escape чистит. Без идущей сессии — подсказка эталона «Please start a
  debug session to evaluate expressions» и плейсхолдером, и ответом на Enter (отступление: у эталона ввод read-only).
  Цвета по severity: `info` (stdout) — обычный цвет (вид спайка), `warning` (`console`) — `warningForeground`,
  `error` (stderr) — `errorForeground`, `ignore` — курсив. Команды — `replActions.ts` (`Ctrl+Shift+Y`/`Ctrl+K Y`,
  Focus, Accept Input, Clear Console); `debug.internalConsoleOptions` и `debug.console.closeOnEnd` — порты
  `openRepl`/`closeRepl` сервиса. Не здесь: ANSI, перенос, автодополнение, фильтр, группы как фича, меню.
- #1148: брейкпоинты в гаттере и текущий кадр (`browser/breakpointEditorContribution.ts` — `BreakpointEditorContribution`
  и `CallStackEditorContribution` эталона над всеми текстовыми вкладками). F9 — `editor.debug.action.toggleBreakpoint`
  (`browser/debugEditorActions.ts`); клик по дорожке — семантика `onMouseDown` эталона (Shift — вкл/выкл, Alt и средняя
  кнопка по `debug.gutterMiddleClickAction` — quick input `browser/breakpointInput.ts` вместо виджета до задачи условий,
  решение 2026-11-14; удаление брейкпоинта с условием — модальный вопрос эталона). Глифы `getBreakpointIcon` цветами
  `debugIcon.*`, на строке один глиф: кадр сильнее брейкпоинта, кадр с брейкпоинтом — `debug-stackframe-active`
  (`◉` без Nerd Font). Брейкпоинт едет трекнутой декорацией документа, позиция пишется в `debug.breakpoint` сразу,
  адаптеру уходит на сохранении файла (`onDidSaveTextFile`). Где ставить — `canSetBreakpointsIn` менеджера адаптеров
  по языку файла (`contributes.breakpoints` из `bindExtensionDebuggers`, `debug.allowBreakpointsEverywhere`). Остановка
  открывает файл кадра (`openStackFrame` в `breakpointSources.ts`; фокус — `debug.focusEditorOnBreak`), строка кадра —
  `ILineHighlightDecoration`. `debug:` документы — `browser/debugContentProvider.ts` через
  `EditorService.registerDocumentSource` (схемы workbench читаются раньше источника расширений, вкладки не
  восстанавливаются). Синтетический адаптер принимает корень программы (`registerSyntheticDebugger(…, root)`), чтобы
  исходники были настоящими файлами. Проверка — `breakpointEditorContribution.app.test.ts`, сценарий
  `debug-breakpoints-gutter` на Debug Demo (теперь с `contributes.breakpoints` для C и остановкой на брейкпоинте).

- #1138: `launch.json`. `browser/debugConfigurationManager.ts` (порт `ConfigurationManager` эталона: launch папки —
  `.diode/launch.json`, блок `launch` файла `.code-workspace`, `launch` пользовательских настроек; выбранная конфигурация
  — ключи эталона `debug.selectedconfigname`/`debug.selectedroot` в scope `workspace`; дубли имён нумеруются, `presentation`
  сортирует и прячет), раздел `launch` сервиса настроек ([Configuration.md](../arch/Configuration.md)),
  `browser/debugTaskRunner.ts` (`preLaunchTask`/`postDebugTask`/`preRestartTask`/`postRestartTask`, `debug.onTaskErrors`
  с диалогом и чекбоксом «Remember my choice», запомненный выбор для ненайденной задачи — `debug.taskerrorchoice`,
  предупреждение о медленной задаче через 10 с, `debug.hideSlowPreLaunchWarning`), compounds (`common/debugCompoundRoot.ts`,
  `stopAll`, `preLaunchTask` compound'а), `debug.saveBeforeStart` (порт `saveAllBeforeStart`, затем
  `reloadConfiguration`), `debug.confirmOnExit` (`browser/debugLifecycle.ts` — вето `LifecycleService.registerShutdownVeto`),
  команды Select and Start Debugging (quick access `debug `, `browser/debugQuickAccess.ts`), Open 'launch.json'
  (создаёт пустой скелет эталона), Add Configuration (пустая строка в `configurations`, курсор на ней). Порты DI —
  `src/vs/diode/modules/debugPorts.ts`. Чекбокс модального сообщения — `INotificationMessage.checkbox`. Отступления:
  F5 без выбранной конфигурации открывает Select and Start Debugging (эталон угадывает отладчик — #1156); Open
  'launch.json' в палитре без предусловия `debugUx != 'simple'` (нет welcome-вида — #1144); Add Configuration без
  сниппетов (веха 2); фоновые задачи ждут конца процесса (problem matcher'ов у фоновых задач нет). Живой сессии в
  бинаре нет до #1139/#1140 (тип отладчика приходит только из расширения): e2e `launch-json` показывает задачу и
  сообщение «not supported», полный F5 на синтетике — `debugCommands.launch.app.test.ts`.

- #1139: провайдеры конфигураций и запуск из расширений. Субпроцесс — `api/common/debugNamespace.ts`
  (бывший `debugNoop.ts`: `registerDebugConfigurationProvider`, `startDebugging`, `stopDebugging` живые,
  остальное — по-прежнему null-объект до #1140/#1141), провод — `debug.*` (`debugWireTypes.ts`,
  `customers/debugCustomer.ts`, `debugWireParsers.ts`), ядро — `contrib/debug/browser/extensionDebugAdapter.ts`
  (`ExtensionDebugAdapter`, `bindExtensionDebuggers` для `contributes.debuggers`). `ConfigurationManager` —
  провайдеры эталона (`resolveConfigurationByProviders` с повтором при смене типа,
  `resolveDebugConfigurationWithSubstitutedVariables`, `provideDebugConfigurations` для нового launch.json),
  `AdapterManager` — `activateDebuggers` и слияние контрибуций одного типа и `*`, `Debugger.substituteVariables` —
  фабрика типа, затем резолвер ядра с `variables` отладчика (порт `variables` — `debugVariableResolver`,
  `inputs` из файла конфигурации). `createSession` и рестарт — последовательность эталона целиком.
  Отступления: нет неявного `onDebugResolve:<type>` (его нет и в эталоне 1.127, хотя спека его называла); нет
  `$substituteVariables` в субпроцессе (резолвер ядра знает те же переменные); динамические конфигурации в
  Select and Start Debugging (`onDebugDynamicConfigurations`, «недавние», кнопка «в launch.json») — отдельным
  PR. Живой F5 по типу расширения доходит до сессии и падает на «Cannot find debug adapter» — адаптер #1140;
  e2e `debug-provider` (расширение Debug Demo в `e2e/fixtures/user-data-with-debug-demo`).
- #1140: адаптеры расширений. Субпроцесс — фабрики дескрипторов и трекеры в `api/common/debugNamespace.ts`,
  исполняемый файл из `contributes.debuggers` — `api/common/debugAdapterExecutable.ts`, адаптеры:
  inline — `api/common/extHostDebugAdapter.ts`, процесс/TCP/пайп — `api/node/extHostDebugAdapters.ts`; провод —
  `debug.registerDebugTypes`, `debug.startAdapter`/`stopAdapter`, `debug.sendAdapterMessage`,
  `debug.acceptAdapterMessage`/`Error`/`Exit`; ядро — `ExtensionHostDebugAdapter` в
  `browser/extensionDebugAdapter.ts`. `Debugger.createDebugAdapter` шлёт `onDebugAdapterProtocolTracker:<type>`.
  Пространство `debug` получило владельца в `extensionApiFactory.ts` (фабрику регистрирует только расширение,
  определяющее тип; заодно провайдеры #1139 теперь приходят с id расширения). Отступления: адаптер, ушедший сам
  (ошибка, выход с кодом ≠ 0, смерть субпроцесса), пишет «Debug adapter process has terminated unexpectedly (…)»
  в Debug Console (`AdapterEndEvent.failure`, эталон молчит); путей в DAP-сообщениях не переводим; `handshake` —
  «no signer». Отдельно починено: `fetchThreads` после `configurationDone` у умершего адаптера отменяется без
  необработанного отказа. Тесты: `extensionHost.debugAdapters.test.ts` (настоящий субпроцесс, адаптер каждого вида,
  фикстура `__fixtures__/debugAdapters/`), сценарий `debug-adapter` (Debug Demo с inline-адаптером).
- #1141: сессии для расширений. `vscode.debug` больше не null-объект: `activeDebugSession`, `activeStackItem`,
  `breakpoints`, `activeDebugConsole`, шесть событий, `addBreakpoints`/`removeBreakpoints`, у `DebugSession` —
  сеттер `name`, `customRequest`, `getDebugProtocolBreakpoint`. Ядро — `ExtensionDebugAdapter.subscribe` и
  методы sink'а в `browser/extensionDebugAdapter.ts`, у сервиса — `addBreakpoints(uri, data)` эталона. Устройство и
  отступления — [Extensions.md](../arch/Extensions.md) («Сессии, брейкпоинты, консоль»). Тесты:
  `extensionDebugAdapter.sessions.test.ts` (настоящий `DebugService`), `extensionHost.debugSessions.test.ts`
  (настоящий субпроцесс, фикстура `__fixtures__/debugSessions/`). Не здесь: data-брейкпоинты (веха 2).
- #1157: IntelliSense `launch.json` по `configurationAttributes`/`configurationSnippets` отладчиков — второй провайдер
  встроенного `diode-settings` (`lib/launchSchema.ts`, `lib/launchCompletion.ts`), устройство и отступления —
  [Extensions.md](../arch/Extensions.md) («Пример: builtin `diode-settings`»). Без диагностик, как у settings.
- #1153: inline values (`browser/inlineValuesContribution.ts`, `InlineValuesContribution` — часть
  `DebugEditorContribution` эталона над всеми текстовыми вкладками). Пока в фокусе кадр файла вкладки,
  `debug.inlineValues` (`on`/`off`/`auto`, в `auto` — только при провайдере языка) показывает значения сообщениями после
  строк (`ILineMessageDecoration`, владелец `debug.inlineValues`, `order: 1` — после бейджей тестов и исключения) цветами
  `editor.inlineValuesForeground` на `editor.inlineValuesBackground`. Источник — `languages.registerInlineValuesProvider`
  (реестр `inlineValuesProvider`, RPC `languages.provideInlineValues`, три вида `InlineValue*`), без провайдера —
  «one-size-fits-all» эталона: имена переменных скоупов кадра в коде (не в комментариях и строках) видимых строк ± экран
  до остановки. Отступления: все слова токена кода, а не первое (у языка без грамматики строка — один токен); текст
  режется на 150 символах; без hover; debounce фиксированный 200 мс; `onDidChangeInlineValues` провайдера никуда не
  ведёт, как у эталона. Проверка — `inlineValuesContribution.app.test.ts`, сценарий `debug-inline-values` на Debug Demo
  (провайдер расширения в папке `e2e/fixtures/debug-inline-values`, F10 у адаптера).

- #1149: приёмка вехи 1 — стоковый CodeLLDB целиком (заметки — [StockExtensions.md](../arch/StockExtensions.md#отладка-cc-vadimcnvscode-lldb-codelldb)).
  Запись магазина `vadimcn.vscode-lldb` (сайт#57, гейт `>=0.17.0`), сценарий `codelldb` (`network: true`, без gcc —
  пропуск). Что всплыло и починено: виды `contributes.views.debug` уходили в Explorer (ключ `debug` → `workbench.view.debug`
  в `viewsExtensionPoint.ts`); клик по «Load More Stack Frames» / «Show N More» в CALL STACK только ставил курсор
  (дерево теперь открывает строку одиночным кликом по `workbench.list.openMode`, как эталон); после шага заголовок
  CALL STACK терял «Paused on step» (нашёл тестировщик: `continued` CodeLLDB и `stopped` обрабатываются в одной задаче,
  фильтр `continued` микрозадачей позже стирал новую остановку — теперь он снимает только остановки, пришедшие до него,
  отступление в `debugSession.ts`). Как в эталоне и оставлено:
  «Load More Stack Frames» после шага, Debug Console поверх терминала `runInTerminal`. После влития — выпуск minor.

- ~~Противоречие в доках~~ (Extensions.md «DAP не планируется» против STATUS.md «planned») снято в #1149: оба описывают
  настоящий отладчик.

## Оценка объёма (эталон vscode 1.127, `contrib/debug`)

| слой                                                          | строк | переносимость                                                                                                      |
| ------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `common/` (модель, сессии, брейкпоинты, `debugProtocol.d.ts`) | ~9.5k | в основном переносится: логика без DOM; `debugProtocol.d.ts` — дословно, остальное адаптировать под наш DI/события |
| `browser/` (виды, редактор, REPL, тулбар)                     | ~26k  | не переносится — DOM; переписываем на tuidom, копируя поведение (как Testing)                                      |
| ext host (`extHostDebugService` + `mainThreadDebugService`)   | ~1.8k | переносится, по образцу `extHostTesting`                                                                           |

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

| расширение                              | загрузок | лицензия          | устройство                                                          |
| --------------------------------------- | -------- | ----------------- | ------------------------------------------------------------------- |
| `vadimcn/vscode-lldb` (CodeLLDB) 1.12.3 | 1.4M     | MIT               | свой адаптер (Rust) + LLDB внутри, платформенные vsix; C/C++ и Rust |
| `eclipse-cdt/cdt-gdb-vscode` 3.0.0      | 1.0M     | EPL               | Node-адаптер поверх gdb/MI (Eclipse Theia)                          |
| `KylinIdeTeam/cppdebug` 0.4.0           | 500k     | не проверяли      | похоже, отладочная часть cpptools (открытый MIEngine)               |
| `llvm-vs-code-extensions/lldb-dap`      | 194k     | Apache 2.0 + LLVM | официальный LLVM, бинарь `lldb-dap` из системы                      |
| `webfreak/debug` (Native Debug) 0.27.0  | 103k     | public domain     | gdb/lldb через MI, заброшен с 2024-02                               |

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
- [x] Контекстные меню: Copy Value, Copy as Expression, Set Value (F2, поле на строке), Add to Watch, Break on Value
      Change/Read/Access, Copy Call Stack, консоль (#1155). Edit Condition у брейкпоинта — #1151.
- [ ] Inline-редактирование watch-выражения (сейчас добавление через quick input).
- [ ] Тулбар: стоит в активной группе и переезжает за ней — проверить, не раздражает ли; ширину выровнять с find.
- [x] Цвет статус-бара во время сессии — `statusbarColorProvider.ts` (порт эталона) + `StatusBarComponent.overrideColors`
      (SPIKE-шов; у эталона — `IStatusbarService.overrideStyle`). Цвет — из темы: Dark Modern синий `#0078D4`,
      запасной `#CC6633`.
- [ ] `ScmActionButtonElement` переиспользован из `contrib/scm` — для влития вынести общую кнопку в `browser/parts/views/`.
- [ ] Выпадающий выбор конфигурации запуска в заголовке Run and Debug (эталон: ▷ + список `launch.json`).
- [ ] Редактор (вне этого спайка): глифы брейкпоинтов в гаттере, подсветка текущей строки
      (`editor.stackFrameHighlightBackground`), hover значений, inline values.
- [ ] После тюнинга — скиллом `spec` нарезать фазы 1–3 на issues для лупа; поправить противоречие в
      Extensions.md.
