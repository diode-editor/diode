# Задачи (tasks)

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).

Фича `contrib/tasks/` — задачи VS Code (`contrib/tasks` эталона: `abstractTaskService` +
`terminalTaskSystem` + `taskQuickPick`), первая итерация — только запуск; трекер и границы —
[TODO/Tasks.md](../../TODO/Tasks.md), API расширений — [Extensions.md](../Extensions.md) («Задачи расширений»).

- **Модель** (`common/tasks.ts`): задача tasks.json (`CustomTask` эталона) и задача провайдера
  (`ContributedTask`) — одна форма `ITask` с источником (`workspace` | `extension`). Id задачи
  tasks.json — `$core.<label>` (у эталона — uuid по имени в пределах сессии), задачи провайдера —
  `${расширение}.${_key}`; «та же задача» — `getMapKey` (папка + id). Дефолты `presentation` и
  `runOptions` — эталонные.
- **`.diode/tasks.json`** (`common/taskConfiguration.ts`): каталог проекта — тот же, что у
  `.diode/settings.json` (`platform/workspace/common/workspaceConfigFolder.ts`, у эталона —
  `.vscode`); `.vscode/tasks.json` не читается, как и `.vscode/settings.json` (импорт настроек VS Code
  — отдельной задачей). Схема 2.0.0 в объёме первой итерации:
  `shell`/`process`, `command` (строка, массив, `{value, quoting}`), `args`, `options`
  (`cwd`/`env`/`shell`), `presentation`, `runOptions`, `detail`, `hide`, `isBackground`, `group`
  (хранится), секции `linux`/`osx`/`windows`, глобальные `options`/`presentation`. Неподдержанное —
  предупреждение в лог `Tasks` (тексты эталона, где они есть), задача не падает. Запись с типом
  провайдера — кастомизация задачи расширения (`ConfiguringTask` эталона, `IConfiguringTask`):
  определение по схеме типа из `contributes.taskDefinitions` (типа нет — ошибка эталона), подпись —
  `label` или «тип: первое обязательное». Сервис сливает её с задачей провайдера по `_key`
  определения (`createCustomizedTask` ≈ `createCustomTask`: `label`, `detail`, `hide`, `group`,
  `isBackground`, матчеры, `presentation`, `options`, `runOptions` записи поверх; id, определение и
  исполнение — провайдера); не дал провайдер такой задачи — ошибка эталона в лог, `resolveTask`
  провайдера не спрашивается. Файл перечитывается на каждом запросе
  задач (дёшево; правка применяется без вотчера), о проблемах одного и того же текста говорится
  один раз.
- **Переменные** (`common/taskVariables.ts`) — с нуля по `variableResolver.ts` эталона:
  `workspaceFolder[Basename]`, `workspaceRoot`, `cwd` (у задачи с папкой — папка, как у эталона),
  `env:`, `config:`, `userHome`, `pathSeparator`/`/`, переменные активного файла (`file`,
  `fileBasename[NoExtension]`, `fileExtname`, `fileDirname`, `relativeFile[Dirname]`, `lineNumber`).
  Неизвестная — как есть (эталон), `${input:}`/`${command:}` — явный отказ, а не запуск с литералом.
- **Исполнение** (`browser/terminalTaskSystem.ts`): шелл по умолчанию — `DefaultShellResolverDIToken`
  (`getSystemShell`; шов в `terminal/common`, потому что имя шелла нужно до создания терминала),
  `-c` + командная строка `_buildShellCommandLine` с таблицей экранирования эталона; процесс —
  исполняемый файл с аргументами. «Executing task: …» (`formatMessageForTerminal`) при `echo`.
  Терминал задачи — `waitOnExit` (`getWaitOnExitValue`): после выхода печатает код выхода и
  «Terminal will be reused by tasks, press any key to close it.» и ждёт; **честный reuse** (В5):
  ждущий терминал перезапускается на месте `TerminalService.relaunchInstance` — `dedicated` берёт
  свой, `shared` — свой или последний освободившийся той же `presentation.group`, `new` — всегда
  новый; `clear` стирает вывод. События — в порядке эталона: Start → Active → ProcessStarted →
  ProcessEnded → Inactive → End (+ Terminated, если терминал закрыли), плюс `changed` на смену
  набора бегущих. `reveal` always/silent (показать при коде ≠ 0)/never, `focus`. Терминал задачи,
  перенесённый в editor area, показывается своей вкладкой (`TerminalEditorService.reveal`, фокус —
  только при `focus`), панель не трогается — как `revealTerminal` эталона; новый терминал задача
  всегда создаёт в панели. **Отступление** (#814): silent-при-ошибке и Show Running Task тоже
  editor-aware, у эталона они зовут `showPanel` вслепую.
- **Матчеры проблем** (#808; `common/problemMatcher.ts` + `common/problemCollectors.ts` — перенос
  `problemMatcher.ts`/`problemCollectors.ts` эталона): модель, разбор inline-матчера tasks.json
  (сообщения эталона в лог `Tasks`, битый матчер пропускается, задача остаётся), встроенные паттерны и
  матчеры эталона дословно. В `ITask.problemMatchers` — имя (как написано, с `$` или без) или
  разобранный объект; имя разрешается при запуске (`_resolveMatchers`: неизвестное — «Problem matcher
  … can't be resolved» в лог), в `filePrefix` подставляются переменные задачи. Секция ОС заменяет
  `problemMatcher` задачи; кастомизация провайдерской задачи перекрывает его матчеры целиком. Обычная
  задача с матчерами получает `StartStopProblemCollector` (стратегия Clean): строки терминала задачи
  (`onLineData` сессии терминала — `LineDataEventAddon` эталона в `XtermSurface`: перенесённые строки
  склеены, без escape-последовательностей; шелл и pty `CustomExecution` одинаково) идут в матчеры по
  очереди, маркеры ресурса уходят в `MarkerService` под `owner` матчера, когда вывод перешёл к другому
  ресурсу, остальное — на выходе. Ресурсы, где у этих owner'ов были маркеры до запуска и которые вывод
  не упомянул, к выходу очищаются (с учётом `applyTo`: открыт ли документ — модель текстового файла
  в редакторе). Выход процесса у терминала ждёт разбора всего вывода до него (последняя строка без
  перевода — тоже строка), а события конца задачи (ProcessEnded…End) — доставки маркеров. Terminate
  и закрытие терминала оставляют найденное. `presentation.revealProblems`: `always` — Problems вместо
  терминала на старте, `onProblem` — Problems на выходе, если было совпадение; `reveal: silent`
  показывает терминал и при ошибках (severity ≥ Error) в выводе с кодом 0. **Отступления:** у
  `isBackground`-задачи матчер игнорируется с предупреждением «Problem matchers are not supported for
  background tasks yet; the matcher is ignored» (у эталона — `WatchingProblemCollector`); в tasks.json
  неизвестное имя матчера не ошибка разбора («Invalid problemMatcher reference» эталона), а сообщение
  при запуске; `Severity` эвристика Windows (`#77475`, длиннее сообщение — заменяет) не перенесена.
- **Матчеры из расширений** (#809; `common/problemMatcherRegistry.ts` — `ProblemPatternRegistry` и
  `ProblemMatcherRegistry` эталона в одном классе, экземпляр держит `TaskService`):
  `contributes.problemPatterns` и `contributes.problemMatchers` всех расширений окна. Регистрирует их
  `bindExtensionTasks` из каталога расширений — статический вклад манифеста, расширение не
  активируется. Сначала паттерны всех расширений, потом матчеры (`deps` эталона): матчер может
  ссылаться на паттерн другого расширения (`"pattern": "$tsc"`) и на `base` — встроенный или
  зарегистрированный раньше. Невалидный вклад — сообщения эталона в лог `Tasks` с id расширения
  (`Invalid problem pattern. The pattern will be ignored.` + JSON паттерна; у матчера — тексты
  `ProblemMatcherParser`), остальные регистрируются. Любое сообщение парсера паттерна делает паттерн
  невалидным: у эталона все они — `error`. Совпадение имени со встроенным или с вкладом раньше —
  **последний выигрывает** (`add` эталона пишет в тот же словарь); порядок — порядок списка
  расширений окна. Пока реестр не готов, `getWorkspaceConfiguration` (разбор tasks.json: `base` и
  `$pattern` inline-матчера) и `run` ждут `onReady()`, как `_computeWorkspaceFolderTasks`/
  `_executeTask` эталона, — матчер не теряется с «can't be resolved». Матчеры из расширений годятся в
  tasks.json, в задачах провайдеров и как `base`. **Отступление:** дельты удаления нет — набор
  расширений статичен на жизнь окна, удалённое или выключенное расширение пропадает из реестра после
  перезагрузки окна (у эталона `delta.removed` удаляет имя и у встроенного матчера с тем же именем).
  `$tsc` объявлен в манифесте `extensions/diode-lsp-typescript` дословно по
  typescript-language-features эталона (паттерн `tsc`, матчер `tsc`: owner `typescript`, source `ts`,
  `applyTo: closedDocuments`, `fileLocation: ["relative", "${cwd}"]`); фоновые `tsc-watch`/`tsgo-watch`
  не перенесены. Код маркера — как у эталона, число без `TS` (`2322`).
- **Сервис** (`browser/taskService.ts`): списки (tasks.json + провайдеры с таймаутом 5 с,
  `task.autoDetect`, `when` типа из `contributes.taskDefinitions`), запуск с `task.saveBeforeRun`
  (`prompt` — модальный `DialogService.confirm`, как `dialogService.confirm` эталона; безымянные
  буферы не сохраняются — Save As посреди запуска задачи не открываем), политика повторного
  запуска (`instancePolicy`: prompt — пикер «Select an instance to terminate», terminateNewest/
  Oldest — перезапуск, warn, silent), Rerun (редакторы сохраняются всегда; нечего — Run Task),
  Restart (задача tasks.json — в нынешнем виде файла), Show Running Tasks, ключ `taskRunning`
  (сервис выставляет его сам на каждом событии системы задач, а не опросом на нажатии).
  Ошибки разбора tasks.json (не предупреждения) — строкой в лог `Tasks` и тостом эталона «There
  are task errors. See the output for details.» с «Show Output» (панель Output на канале Tasks),
  один раз на текст файла.
  Активатор провайдеров, типы задач и мост pty `CustomExecution` ставит проводка extension host'а
  (`bindExtensionTasks`) — без неё сервис работает с одним tasks.json.
- **Пикер Run Task** (`browser/taskQuickPick.ts`): первый уровень — configured и по строке на тип
  (`$(folder) <type>`) + «Show All Tasks...», второй — задачи типа + «Go back ↩». Разделителей
  групп у нашего quick pick нет — подпись группы («configured»/«contributed») стоит подсказкой
  справа у первой строки группы; второй строки нет — `detail` (`task.quickOpen.detail`) идёт в
  описание строки. Кастомизации стоят в «configured» по подписи, задачу провайдера под ними
  ищут только по выбору (первый уровень провайдеров не опрашивает, как эталон с `ConfiguringTask`).
  Своих задач нет — строка «Configure a Task» (ведёт в Configure Task).
- **Configure Task** (`browser/configureTask.ts`, `_runConfigureTasks` эталона): пикер всех задач
  + «Create tasks.json file from template» / «Open tasks.json file», пока своих нет. Своя (или
  кастомизированная) задача — tasks.json открывается кареткой на её записи; задача провайдера —
  её кастомизация (`customizationEntryOf` ≈ `_createCustomizableTask`) дописывается в конец `tasks`
  и файл открывается на ней; строка файла — шаблоны эталона (`common/taskTemplates.ts`: MSBuild,
  maven, .NET Core, Others; табы → пробелы по `editor.insertSpaces`/`tabSize`). Правка текста —
  `common/tasksJsonEdits.ts`: запись вставляется перед `]` руками, а не `modify` jsonc-parser — тот
  переформатировал бы соседнюю запись и унёс бы её хвостовой комментарий; остальной текст файла
  не меняется. Битый файл — предупреждение эталона, открытый с несохранёнными правками — ошибка
  эталона, файл не пишется; чистый открытый перечитывается сразу после записи.
- **Команды** (`browser/taskActions.ts`): `workbench.action.tasks.{runTask,reRunTask,restartTask,
  terminate,showTasks,configureTaskRunner}` с заголовками палитры эталона и аргументами (`runTask` —
  подпись или определение `{type,…}`, `terminate` — `'terminateAll'`); меню Terminal меню-бара
  (новое: New Terminal, Run Task..., Show Running/Restart/Terminate — последние гаснут без
  `taskRunning`, Configure Tasks...).
  Команда кончается запуском, а не задачей.
- **Статус-бар** (`browser/taskStatusBarContribution.ts`): `$(tools) N` бегущих, id
  `status.runningTasks`, клик — Show Running Tasks; подсказок у записей статус-бара нет.
- **Настройки** — узел `workbench/common/configuration/tasksConfiguration.ts` (центрально, как
  остальные узлы фич — см. [таблицу долга](../../TODO/VscodeStructureFollowUps.md#где-канон-состав-фичи-ещё-не-выполнен)).

**Отступления от эталона** (сверх «не входит» трекера): нет workspace trust — Run Task ничего не
спрашивает; мультирута нет — задачи первой папки; reuse терминала только между задачами одного
вида исполнения (шелл/процесс ↔ `CustomExecution` — новый терминал); задачи tasks.json получают id
по метке, а не uuid; на Windows аргументы шелла уходят массивом (у эталона для cmd/powershell —
одной строкой); пикер второго уровня на время загрузки провайдеров (до 5 с) не показывается —
busy-состояния (`picker.busy` эталона) у нашего quick pick нет; `markdownDescription` настроек —
обычным `description` (реестр настроек markdown-описаний не знает). Configure Task: кнопки-шестерёнки
«Configure Task» у строк Run Task нет (кнопок у строк нашего quick pick нет); выделения у редактора
нет — запись показывается кареткой в её начале и прокруткой к ней; кастомизация задачи провайдера
без папки пишется в tasks.json первой папки (у эталона — ничего не делает); файл без задач
получает ключи шаблона `modify`'ем поверх своих ключей (у эталона — `updateValue('tasks', …)`).
