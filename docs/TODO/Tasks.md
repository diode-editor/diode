# Tasks — задачи (tasks) в Diode

Аналог задач VS Code: ядро редактора (`contrib/tasks/`, Run Task и соседи) и API
расширений `vscode.tasks`. Первая итерация — **только запуск**: problem matchers не
делаем. Устройство и отступления от эталона — [docs/arch/workbench/Tasks.md](../arch/workbench/Tasks.md),
провод — [docs/arch/Extensions.md](../arch/Extensions.md).

Эталон — `src/vs/workbench/contrib/tasks/` и `api/{common,browser,node}/*Task*.ts`
(`node scripts/vscode-ref.mjs`).

## Первая итерация — сделана (#572, `.diode/tasks.json` — #575)

- [x] S1 «Tasks: Run Task» — двухуровневый пикер: configured из `.diode/tasks.json`,
  затем по пункту на тип провайдера (`contributes.taskDefinitions`) → задачи типа, «Go back ↩»;
  «Show All Tasks...».
- [x] S2 задачи из `.diode/tasks.json` (2.0.0; каталог проекта Diode, `.vscode/` не читается): `type: shell|process`, `label`, `command`
  (строка | `{value, quoting}`), `args`, `options.cwd/env/shell{executable,args}`,
  `presentation`, `detail`, `isBackground`, `runOptions`, секции `linux`/`osx`/`windows`,
  глобальные `options`/`presentation`.
- [x] S3 Rerun Last Task (`workbench.action.tasks.reRunTask`; нечего — открыть Run Task;
  `runOptions.reevaluateOnRerun`).
- [x] S4 Terminate Task (пикер бегущих + «All Running Tasks», аргумент `'terminateAll'`),
  Restart Running Task, Show Running Tasks.
- [x] S5 вывод в терминале задачи: «Executing task: …», сообщение о коде выхода,
  «Terminal will be reused by tasks, press any key to close it.»; `presentation.panel`
  dedicated/shared/new — честный reuse терминала.
- [x] S6 запуск уже бегущей задачи — `runOptions.instancePolicy` (дефолт `prompt`:
  «Select an instance to terminate» → перезапуск).
- [x] S7 провайдеры: `tasks.registerTaskProvider`, `contributes.taskDefinitions`, `onTaskType:`.
- [x] S8 `tasks.executeTask`, `taskExecutions`, `onDidStart/EndTask`,
  `onDidStart/EndTaskProcess`, `TaskExecution.terminate()`, `fetchTasks`.
- [x] S9 `CustomExecution` на pty расширения.
- [x] Статус-бар `$(tools) N` бегущих задач (`status.runningTasks`).
- [x] Настройки: `task.autoDetect`, `task.saveBeforeRun`, `task.quickOpen.skip`,
  `task.quickOpen.detail`, `task.slowProviderWarning`, `task.verboseLogging`.

## Не входит (отложено — отдельными задачами)

Записано заранее, чтобы первая итерация не расползлась.

- [ ] Группы `build`/`test`: Run Build Task (Ctrl+Shift+B), Run Test Task, Configure Default
  Build/Test Task. Поле `group` читается и хранится, но ни на что не влияет.
- [ ] `dependsOn` / `dependsOrder` — задача с ними запускается без зависимостей, warn в лог `tasks`.
- [ ] Автозапуск: `runOptions.runOn: folderOpen`, `task.allowAutomaticTasks`, Manage Automatic Tasks.
- [ ] История «recently used» в пикере (`task.quickOpen.history`).
- [ ] `inputs` / `${input:…}` / `${command:…}` — задача с ними падает с явной ошибкой
  «переменная не поддержана», а не запускается с литералом.
- [x] Configure Task (`workbench.action.tasks.configureTaskRunner`) и шаблоны tasks.json
  («Create tasks.json file from template»), «Configure a Task» в пустом Run Task.
- [ ] User Tasks (Open User Tasks), Open Workspace Tasks, кнопка «Configure Task» у строк Run Task.
- [ ] Rerun Task для активного терминала (`rerunForActiveTerminal`), Rerun All Running Tasks.
- [x] Записи tasks.json с типом провайдера (кастомизация задачи расширения) сливаются с задачей
  провайдера по ключу определения.
- [ ] `resolveTask` провайдера для такой записи, когда `provideTasks` задачи не дал (сейчас —
  ошибка эталона в лог `tasks`, задачи нет).
- [ ] `runOptions.instanceLimit` > 1 — одна копия задачи, лимит пишется предупреждением.
- [ ] Мультирут: задачи берутся из первой папки воркспейса.
- [ ] Импорт `.vscode/tasks.json` (вместе с настройками VS Code) — сейчас `.vscode/` не читается.
- [ ] Повторное использование терминала между задачами РАЗНЫХ видов исполнения
  (шелл/процесс ↔ `CustomExecution`) — у эталона так можно, у нас такая задача получает новый
  терминал.
- [ ] `task.quickOpen.showAll` (медленный одноуровневый пикер).
- [ ] **Problem matchers — по мере надобности** (решение человека 2026-10-21: не «не будет», а когда
  понадобятся). Сейчас `problemMatcher` (`$tsc`, `$eslint-stylish`, …) принимается и игнорируется;
  `isBackground`-задача без матчера «бежит» до выхода процесса — так ведёт себя и эталон без
  матчера. Вместе с матчерами: разбор вывода задачи в маркеры PROBLEMS (`IMarkerService`), фоновые
  задачи с `beginsPattern`/`endsPattern`, Show Task Log, toggleProblems,
  `task.problemMatchers.neverPrompt`.

## Не будет (вне цели)

- Переподключение к задачам после перезагрузки окна (`task.reconnection`).
- Уведомление ОС о завершении задачи (`task.notifyWindowOnTaskCompletion`).
