# Go: стоковый `golang.go` (gopls) поверх extension host

Статус: **[ ] спайк сделан, пул задач ниже.** Маршрут тот же, что у Java и Python:
настоящий `golang.go` с open-vsx как есть, ни строчки нашего кода расширения;
gopls поднимает стоковый `vscode-languageclient` внутри расширения. Родственные
документы: [LSP.md](LSP.md), [JavaLSP.md](JavaLSP.md), [Marketplace.md](Marketplace.md).

**Решения человека (октябрь 2026):**

- Языковые фичи, которых ядро ещё не умеет (CodeLens, inlay hints, outline, …), ради Go
  отдельно **не делаем** — они заработают сами, когда появятся в ядре (волна C).
- **Отладчик не делаем.** `vscode.debug` — только null-объект, чтобы активация не падала.

## Отчёт спайка (октябрь 2026)

Живой прогон: `golang.go@0.56.1` (universal, 0.6 МБ) с open-vsx, diode из исходников
через `npm run drive`, Go 1.27.2, gopls v0.24.0, фикстура — модуль с пакетом,
тестом и ошибкой типов.

### Как расширение поднимает сервер

- **Активация** — `onLanguage:go` (+ `go.mod`, `go.sum`, `go.work`, `gotmpl`, `go.asm`)
  и неявные `onCommand:`: всё это у нас уже есть, `workspaceContains:` не нужен.
- **gopls в vsix нет.** Расширение ищет `go` (`go.goroot` → `GOROOT` → `PATH`),
  отсутствующий gopls **ставит само** `go install golang.org/x/tools/gopls@latest`
  в `GOBIN` (`~/go/bin`) — без вопроса, с логом в канале «Go». Транспорт — stdio.
  Значит, платформенных vsix не нужно (в отличие от Java), но пользователю нужен
  Go toolchain, а первая установка gopls — сеть и минута-две на сборку.
- **Без `go` в PATH** — эталонное поведение: тост «Failed to find the "go" binary…»
  с рабочей кнопкой «Go to Download Page», активация отказывает (так же в VS Code).

### Что работает уже сейчас (до любых правок)

Порядок в `activate()`: `startLanguageServer` идёт **до** регистрации дебаггера, поэтому
gopls жив, даже когда активация падает (дыра №1 ниже).

| что | результат |
|---|---|
| диагностики | ✅ squiggle + PROBLEMS (`"os" imported and not used`, ошибка типов) |
| hover | ✅ подпись + doc-комментарий (но с сырыми `---`, дыра №8) |
| F12 внутри модуля и в stdlib | ✅ `greet.Hello` → `greet.go`, `strings.ToUpper` → `$GOROOT/src/strings/strings.go` |
| автодополнение | 🟡 попап есть, но фильтрация и авто-импорт сломаны (№6, №7) |
| rename (F2) | ✅ |
| format document | ✅ gofmt |
| organize imports | ✅ команда и on-save (`[go]` из `configurationDefaults` расширения: `formatOnSave` + `codeActionsOnSave`) |
| semantic tokens | ✅ запрашиваются и применяются |
| статус-бар | ✅ версия Go (`1.27.2`), по клику — меню `go.environment.status` |
| `Go: Test File` / `Test Package` | ✅ `go test` в канал «Go Tests» |
| Run Task → `go: build/test package/workspace` | ✅ task provider, вывод в терминале |
| `Go: Install/Update Tools` | ✅ мульти-выбор `showQuickPick` + `go install` |
| `go.mod` | ✅ язык «Go Module File» |

### Дыры, найденные спайком

Номера — порядок, в котором били. Проверено хаком (патч не закоммичен): с null-объектами
№1–№3 и типами №4 активация доходит до конца, все ~60 команд `go.*` регистрируются.

1. **`vscode.debug` в рантайме нет совсем** → `TypeError: Cannot read properties of
   undefined (reading 'registerDebugConfigurationProvider')`, активация обрывается,
   команды `go.*` после этой точки не регистрируются. Члены, которые трогает
   активация: `registerDebugConfigurationProvider`, `registerDebugAdapterDescriptorFactory`,
   `registerDebugAdapterTrackerFactory`; позже — `onDidStart/TerminateDebugSession`,
   `activeDebugSession`, `activeDebugConsole`, `startDebugging`, `stopDebugging`.
2. **`vscode.tests` нет**, а `go.testExplorer.enable` по умолчанию `true` →
   `createTestController("go", "Go")`, затем три `createRunProfile`, `items.get` на
   открытии тест-файла.
3. **`languages.setLanguageConfiguration` нет** — вызывается в самом конце `activate`
   (`wordPattern` для `go`).
4. **Типы-значения, которых нет в namespace:** `TestRunProfileKind` (падение сразу после
   №2: `reading 'Run'`), `TestMessage`, `TestRunRequest`, `DebugAdapterServer`,
   `DebugAdapterInlineImplementation`, `DocumentSymbol` (класс — им расширение строит свой
   символ-провайдер для тестов и package outline), `QuickPickItemKind`, `NotebookCellKind`.
5. **Деревья** `go.explorer`, `go.package.outline`, `go.test.profile` — уже штатные
   заглушки (warn в Output), не падают.
6. **Completion: поздний неполный ответ не перезапрашивается под текущий префикс.**
   vscode-go при `isIncomplete: true` намеренно ставит ВСЕМ пунктам `filterText` первого
   (фильтрует gopls, клиент обязан перезапрашивать на каждый символ). Набрал
   `strings.ToL` быстрее, чем пришёл ответ на `strings.` — попап показывает весь пакет
   (55 пунктов, `Builder`, `Clone`, …) и стоит так до следующего символа.
   `completionService.ts` перезапрашивает только на ввод **после** ответа; эталон
   (`SuggestModel`) по приходу результата для устаревшего контекста сразу
   перезапрашивает. Баг общий для любых `isIncomplete`-серверов, у Go — бьёт всегда.
7. **Completion: авто-импорт теряется.** gopls кладёт импорт непрописанного пакета в
   `additionalTextEdits` пункта сразу (resolve-провайдера у gopls нет). Мы их в первом
   ответе не сериализуем (`serializeCompletionItem`), а `languages.resolveCompletionItem`
   без `provider.resolveCompletionItem` отдаёт `null` → `strings.ToLower()` вставляется
   без `import "strings"`. Баг общий.
8. **Hover: `---` (thematic break) печатается как есть** — `stripMarkdown`
   (`hoverService.ts`) его не знает. gopls разделяет им подпись, doc и ссылку на pkg.go.dev.
9. **Встроенной команды `vscode.open` нет** → `Go: Toggle Test File` молчит, в лог
   unhandled rejection `command "vscode.open" not found`.
10. **`workbench.action.openSettingsJson` нет** — кнопка «Open settings.json» в тостах
    валидации настроек `go.*` (4 места).
11. **Untitled-документов нет:** `workspace.openTextDocument({ content, language })` →
    `FileSystemError.Unavailable` → `Go: Locate Configured Go Tools` падает.
12. **`workspace.saveAll` нет** — middleware `executeCommand` зовёт его перед
    `gopls.tidy` / `gopls.vulncheck` / `gopls.run_govulncheck` (code action «go mod tidy»
    в `go.mod`) → команда падает.
13. **Мелочи по командам:** `window.createQuickPick` (меню выбора процесса, ленивый enum в
    `go.languageserver.maintain`), `showOpenDialog`/`showSaveDialog`
    (`Go: Choose Go Environment` → «из файла»), `workspace.updateWorkspaceFolders`
    (`Go: Add Package to Workspace`), `env.asExternalUri` (просмотр pprof-профиля —
    всё равно webview). `testing.showMostRecentOutput` нет — расширение зовёт его
    только из Test Explorer.
14. **Косметика лога:** отказ активации не-`Error`-значением пишется как
    `{"name":"Error","message":"undefined"}`.

## Пул задач

### Волна A — `golang.go` активируется целиком и закрыт гейтами (один PR)

- [ ] **A1. Null-объект `vscode.debug`** (№1): `register*` → Disposable, события — no-op
      подписка, `activeDebugSession`/`activeDebugConsole` — `undefined`/инертная консоль,
      `startDebugging` → `false`; одна warn-строка в Output на расширение (как у webview
      и comments). Классы `DebugAdapterServer`, `DebugAdapterInlineImplementation`,
      `DebugAdapterExecutable`. `onDebug*` события активации так и остаются 🕐.
- [ ] **A2. Null-объект `vscode.tests`** (№2): инертный `TestController`
      (`items` — рабочая коллекция, `createTestItem`, `createRunProfile`,
      `createTestRun`, `resolveHandler`/`refreshHandler` — поля) по образцу
      `commentsNoop.ts`; значения `TestRunProfileKind`, `TestMessage`, `TestRunRequest`,
      `TestRunResult`-подобные — по `vscode.d.ts`. Курируемый `go.testExplorer.enable: false`
      при этом **не нужен**.
- [ ] **A3. `languages.setLanguageConfiguration`** (№3): принять конфигурацию и применить
      то, что ядро уже умеет из `language-configuration.json` (минимум `wordPattern`,
      скобки, комментарии); остальное — назвать в API-COVERAGE.
- [ ] **A4. Типы** (№4): `DocumentSymbol` (класс с `children`), `QuickPickItemKind`,
      `NotebookCellKind`.
- [ ] **A5. Тесты по DoD:** герметичный тест на синтетическом расширении (активация
      с `debug`/`tests`/`setLanguageConfiguration` проходит), сьюта
      `extensionHost.goLsp*` на стоковом vsix (`goFixture.ts`, близнец `javaFixture.ts`),
      e2e `goLsp.test.ts`, сценарий-демо `e2e/scenarios/go-lsp.scenario.ts`
      (`installVsix`), обновить [API-COVERAGE.md](../public/API-COVERAGE.md).
- [ ] **A6. CI:** Go toolchain (`actions/setup-go`) в джобах, где идут стоковые сьюты,
      и кэш `GOBIN`/`GOMODCACHE` с gopls — иначе каждый прогон ставит gopls по сети.
- [ ] **A7. Запись в магазине** — `proxy-openvsx`, universal, без платформенной оси
      (реестр + смоук в `e2e/marketplace/checks.ts`).

### Волна B — дыры ядра, найденные на Go (общие, по PR на пункт)

- [ ] **B1. Completion: перезапрос неполного списка, пришедшего под устаревший префикс** (№6).
- [ ] **B2. Completion: `additionalTextEdits` из первого ответа** (№7) — сериализовать
      сразу и не терять, когда resolve-провайдера нет.
- [ ] **B3. Hover: thematic break** (№8) — линия-разделитель, как между блоками провайдеров.
- [ ] **B4. Встроенная команда `vscode.open`** (№9) — `(uri, columnOrOptions?)`, как
      API-команда эталона.
- [ ] **B5. `workbench.action.openSettingsJson`** (№10).
- [ ] **B6. `workspace.saveAll`** (№12) — сервис сохранения уже есть, нужен мост.
- [ ] **B7. Untitled-документы `openTextDocument({ content, language })`** (№11) —
      read-only вкладка на тех же рельсах, что виртуальные документы `jdt:`.
- [ ] **B8. Мелочи** (№13–№14): `createQuickPick`, `showOpenDialog`/`showSaveDialog`,
      `updateWorkspaceFolders`, формат лога отказа активации.

### Волна C — заработает само, когда фичи появятся в ядре (ради Go не делаем)

CodeLens (gopls: `run test`, `go mod tidy` / `upgrade` над `go.mod`; расширение —
`run test | debug test`), inlay hints, documentSymbol / outline, Go to Implementation /
Type Definition, document highlight, call hierarchy, `createLanguageStatusItem` в UI,
деревья (`go.explorer`, package outline), Test API во view Testing,
`contributes.menus` `commandPalette` (when-фильтр палитры).

**Не будет:** отладчик (решение человека), welcome-страница и pprof (webview).

## Открытые вопросы

- **gopls в тестах:** ставить в фикстуре заранее (`go install` в кэш, как `npm install
  eslint` у `eslintFixture.ts`) или проверять и путь авто-установки расширением?
  Дефолт — фикстура ставит заранее, авто-установку закрывает один e2e.
- **Сообщение пользователю без Go:** тост расширения уже честный; нужна ли строка на
  странице расширения в магазине («требует Go toolchain»)?

## Как воспроизвести спайк

```bash
# Go — в любой каталог, gopls не обязателен (расширение поставит само)
curl -sfL https://go.dev/dl/go1.27.2.linux-amd64.tar.gz | tar -xz -C <dir>
# vsix — с open-vsx (в реестре магазина записи пока нет, см. A7)
curl -sfL "$(curl -sf https://open-vsx.org/api/golang/go | jq -r .files.download)" -o go.vsix
PATH=<dir>/go/bin:$PATH npm run -s drive -- start --seed <go-модуль> \
    --install ./go.vsix --open main.go
npm run -s drive -- output extensions.host      # failed to activate … registerDebugConfigurationProvider
npm run -s drive -- output extensions.golang.go.go
```
