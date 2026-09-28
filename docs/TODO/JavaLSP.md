# Java: стоковый `redhat.java` (jdt.ls) поверх extension host

Статус: **код закрыт, осталась запись в магазине.** Документ начинался как отчёт
спайка (он же ниже целиком — «Дыры, которые нашлись»); дыры №0–№6 закрыты
четырьмя PR, и стоковый `redhat.java@1.57` поднимается в Diode целиком. Открыт
один пункт — запись в реестр магазина. Родственные документы: [LSP.md](LSP.md),
[Marketplace.md](Marketplace.md).

## Что сделано

| дыра | чем закрыта |
|---|---|
| №0 `workspaceContains:` / `onCommand:` | #359 — честные события активации |
| №1 `jdt://` роняет редактор | #363 — виртуальные read-only документы + «команда не роняет процесс» |
| №2 storage-каталоги `ExtensionContext` | влито ранее (`globalStorageUri`/`storageUri`/`logUri`/`secrets`) |
| №3 `createStatusBarItem` + `StatusBarAlignment` | влито ранее (узел n-6) |
| №4 встроенная команда `setContext` | влито ранее |
| №5 диалоги с кнопками, `showQuickPick`/`showInputBox` | #352 и узел n-8 |
| №6 `workspace.fs`, `findFiles`, `env.*`, custom editor | **этот PR** |

Проверено живьём на стоковом `redhat.java@1.57` (maven- и gradle-фикстуры,
JDK 21): расширение активируется само, в extension host не остаётся ни одной
ошибки, jdt.ls поднимается в обоих режимах, диагностики в PROBLEMS, «Java: Ready»
в статус-баре, телеметрический тост Red Hat с рабочими кнопками, а F12 на классе
из jar открывает его исходник отдельной вкладкой.

## Что осталось

- [ ] **Запись в реестр магазина** — платформенные vsix (`linux-x64`, `linux-arm64`,
      `darwin-*`, `win32-*`; 133 МБ, с вшитым JRE 21) плюс `universal` (54 МБ) и гейт
      `engines.diode`. Затрагивает три репозитория (реестр, сайт, витрина) — отдельная
      задача, см. [Marketplace.md](Marketplace.md). Со стороны клиента блокер снят:
      артефакт качается потоком в файл, дефолтный лимит поднят с 64 МиБ до 256 МиБ, —
      осталось поднять `MAX_ARTIFACT_BYTES` валидатора реестра и выставить
      `engines.diode` по версии, в которой правка вышла.
- [ ] **Курируемый дефолт `java.jdt.ls.lombokSupport.enabled: false`** снят вместе с
      дефектом lombok/JDT: как только связка перестанет ломать компиляцию, строку из
      `curatedConfigInjection` надо убрать (см. «Прочие наблюдения» ниже).

---

## Отчёт спайка (сентябрь 2026)

Ниже — исходный отчёт исследования в том виде, в каком он писался по живым
прогонам. Разделы «Дыры» читать как историю: все они закрыты, но описание
механики `redhat.java` и jdt.ls остаётся актуальным.

## Короткий ответ

**Maven и Gradle взлетают.** На настоящем `redhat.java@1.57.2026091208` с open-vsx,
в headless-diode, на двух фикстурах (`pom.xml` с `commons-lang3` и `build.gradle`
с тем же деп-ом) проверено вживую:

| что | результат |
|---|---|
| импорт maven-проекта (m2e) | ✅ classpath из pom, деп скачался, `target/classes` собрался |
| импорт gradle-проекта (Buildship) | ✅ classpath из `build.gradle`, `.gradle/`+`bin/main` созданы, дистрибутив gradle 9.7.1 скачался в `~/.gradle` |
| диагностики | ✅ `Type mismatch: cannot convert from String to int` в редакторе и в панели PROBLEMS |
| hover | ✅ подпись + javadoc **из jar-а зависимости** (т.е. classpath действительно живой) |
| автодополнение | ✅ `message.` → методы `String` из JDK |
| go to definition внутри проекта | ✅ F12 на `greet(...)` прыгает на объявление |
| find all references | ✅ 2 вхождения, панель REFERENCES |
| code actions / quick fix | ✅ меню от jdt.ls (`Change type of 'broken' to 'String'`, organize imports, generate…), выбранный фикс применился |
| format document | ✅ Eclipse-форматтер вернул испорченный отступ |
| folding | ✅ сервер отдаёт `foldingRange` (в отличие от basedpyright) |
| **go to definition в библиотеку/JDK** | ❌ **падение всего редактора** (см. «Дыра №1») |

Активация при этом не случается сама: у `redhat.java` нет ни одного события
активации, которое умеет diode (см. «Дыра №0»). *(Закрыто в #359.)*

## Как это устроено у redhat.java (то, что важно знать про «список проектов» и т.п.)

- **LSP-протокол пишет не diode.** Расширение поднимает сервер стоковым
  `vscode-languageclient@10` — тот же мажор, что у basedpyright, у которого уже всё
  работает. Транспорт по умолчанию — `TransportKind.pipe` (unix-сокет,
  `--pipe=/tmp/lsp-<hash>.sock`), т.е. **форка `process.execPath` не происходит** и
  SEA-грабля basedpyright'а (`DIODE_RUN_AS_NODE`) здесь не при чём. Переключается
  настройкой `java.transport`.
- **Сервер — Eclipse JDT LS**: `java -jar server/plugins/org.eclipse.equinox.launcher_*.jar
  -configuration <dir> -data <jdt_ws> --pipe=<sock>`; 114 osgi-плагинов в vsix.
  Никакого «своего протокола импорта» нет: проектную модель строит сам сервер
  (m2e для maven, Buildship для gradle), клиент про неё знает только из
  кастомных нотификаций.
- **`java.server.launchMode: "Hybrid"` (дефолт) = ДВА JVM**: сначала
  «syntax server» (`config_ss_linux`, `ss_ws`) для мгновенной подсветки, параллельно
  поднимается «standard server» (`config_linux`, `jdt_ws`), после его готовности
  syntax server сам выходит (в логе: `Server process exited successfully`).
  Дефолтные vmargs — `-Xmx2G`; плюс gradle-демон третьим JVM на gradle-проектах.
  Для TUI-редактора это самый тяжёлый LSP из имеющихся.
- **Каталоги состояния — из `ExtensionContext`**: `-configuration` копируется в
  `context.globalStorageUri/<версия>/config_linux` (каталог должен быть
  записываемым), `-data` = `context.storagePath + /jdt_ws`. Если `storagePath`
  нет — фолбэк на `os.tmpdir()/vscodesws_<rand>`.
- **Список проектов** — не TreeView. Сам `redhat.java` не создаёт ни одного
  `createTreeView`/`registerWebviewViewProvider`: вид «Java Projects» живёт в
  ДРУГОМ расширении (`vscjava.vscode-java-dependency`, часть Extension Pack for
  Java). У `redhat.java` состав проектов виден только двумя способами:
  - `commands.executeCommand("setContext", "java.projects", [<пути>])` — встроенная
    команда VS Code (в ядре diode её нет, см. «Дыра №4»);
  - статус-бар/`languages.createLanguageStatusItem` («Java: Ready», ⚙ во время сборки)
    и `window.withProgress` («Opening Java Projects» — у нас работает, спиннер в статус-баре).
- **Watchers для переимпорта**: клиент по dynamic registration просит watcher'ы на
  `**/pom.xml`, `**/*.gradle`, `**/*.gradle.kts`, `**/gradle.properties`, `**/.classpath`,
  `**/.project`, `**/.settings/*.prefs`, `**/src/**`, `**/*.java` — наш
  `createFileSystemWatcher` их принимает штатно (видно в RPC-логе). Т.е. «поправил
  pom → переимпорт» механически возможно; мешает только неотвечаемый диалог
  (см. «Дыра №5»).
- **JRE для сервера**: `resolveRequirements` ищет в порядке — `extension/jre/*/bin/java`
  (bundled), `java.jdt.ls.java.home`, `JAVA_HOME`/`PATH` (через `jdk-utils`).
  Минимум — **JDK 21** (25, если включить `java.jdt.ls.javac.enabled: "on"`).
  Важно для магазина: у записи есть **платформенные vsix** (`linux-x64`, `linux-arm64`,
  `darwin-*`, `win32-*`; 133 МБ) с **вшитым JRE 21.0.12**, и `universal` (54 МБ) без него.
  Ось `targetPlatform` у нас уже есть (#305/#306), exec-бит из zip тоже
  восстанавливается — значит можно отдать пользователю вариант «ничего
  доустанавливать не нужно». На `universal` без JDK расширение падает на активации
  и показывает неотвечаемый `showErrorMessage` с кнопкой.

## Дыры, которые нашлись (в порядке, в котором били)

### №0. `workspaceContains:` — активации нет вообще

`activationEvents` у `redhat.java`: двенадцать `workspaceContains:*` (pom.xml,
build.gradle[.kts], settings.gradle[.kts], .classpath — в корне и на один уровень
вглубь) + два `onCommand:_java.*`. diode фаерит только `*`, `onLanguage:<id>` и
`onStartupFinished` — **ни одно из событий расширения недостижимо**, оно
регистрируется и молчит. `onLanguage:java` в манифесте нет.

Спайк-обходка: сканирование корня воркспейса по этим глобам + `activateByEvent`
(в `main.ts`, ~35 строк). Продуктовый вариант — честный `workspaceContains:`
(и заодно `onCommand:`), это самостоятельная небольшая задача из фазы
«activation» [Extensions.md](Extensions.md).

### №1. `jdt://` — F12 в библиотеку роняет редактор (баг, не пробел)

jdt.ls на определение из зависимости отвечает URI вида
`jdt://contents/commons-lang3-3.14.0.jar/org.apache.commons.lang3/StringUtils.java?...`
(содержимое отдаёт `registerTextDocumentContentProvider` расширения — схемы
`jdt` и `class`, поверх серверного `java/classFileContents`). У нас:

```
Error: TextFileModel.openFile: ожидается file:-uri, получен jdt:
    at EditorService.createFileModel (editorService.ts:1166)
    at DefinitionService.doRevealLocation (definitionService.ts:66)
```

— необработанный throw, процесс умирает целиком. Это не «фича не поддержана», а
падение по пользовательскому F12 и лечить надо в любом случае (минимум — не
падать; правильно — виртуальные read-only документы поверх
`workspace.registerTextDocumentContentProvider`, который в шиме уже есть, но в
ядре ни с чем не связан). Тем же путём ходят «Go to Super Implementation»,
декомпиляция и переход в JDK.

### №2. `ExtensionContext` без storage-каталогов

Нет `storagePath`/`globalStoragePath`/`storageUri`/`globalStorageUri`/`logUri`/
`secrets`/`extension`. Первое падение активации — как раз про `globalStorageUri`
(в него копируется `-configuration`). Спайк выдаёт реальные каталоги в
`os.tmpdir()`; в продукте им место в `<user-data>/User/{globalStorage,workspaceStorage}`.

### №3. `window.createStatusBarItem` + `StatusBarAlignment`

Второе падение активации: `Cannot read properties of undefined (reading 'Left')` —
расширение читает `vscode.StatusBarAlignment.Left`. Ни enum'а, ни
`createStatusBarItem` в шиме нет. Это же место — единственный канал «сервер
жив/строит/готов» у Java, так что фейк-заглушкой закрывать жалко.

### №4. Встроенной команды `setContext` в ядре нет

`redhat.java` зовёт `setContext` на каждое обновление состояния (`java.projects`,
`javaLSReady`, …) → `command "setContext" not found` + unhandled rejection в
субпроцессе. Механика when-контекстов у нас есть (`ContextKeys.ts`), не хватает
ровно моста «команда `setContext` → context key».

### №5. Диалоги с кнопками не отвечаемы — и это ломает переимпорт

`window.show{Information,Warning,Error}Message` игнорирует `items` и всегда
резолвится `undefined` («закрыли»). Последствия для Java конкретные:

- дефолт `java.configuration.updateBuildConfiguration: "interactive"` — после правки
  `pom.xml`/`build.gradle` сервер спрашивает «Synchronize now / Never», ответа не
  будет ⇒ **переимпорт никогда не выполнится**. В спайке лечится настройкой
  `"automatic"` (кандидат в `curatedConfigInjection`);
- `showErrorMessage` про отсутствующий JDK с кнопкой «Get the Java Development Kit»
  — тупик;
- checksum-подтверждение gradle wrapper'а — тоже диалог.

Плюс `showQuickPick`/`showInputBox` в шиме отсутствуют вовсе — а на них висит весь
«интерактивный» слой jdt.ls через `workspace/executeClientCommand`:
Override/Implement Methods, Generate getters/setters/constructors, extract-рефакторинги
с вводом имени, выбор проекта при импорте. В меню code actions такие пункты видны,
но по Enter ничего не произойдёт.

### №6. Мелочи, добитые стабами за минуту

- `workspace.fs` умеет только `stat/readFile/writeFile` → `fs.createDirectory is not a
  function` (нужны ещё `readDirectory/delete/rename/copy`);
- `workspace.findFiles` нет (расширение зовёт его 10 раз — детект билд-файлов);
- `env.isTelemetryEnabled`/`onDidChangeTelemetryEnabled`/`machineId`/`sessionId` нет
  (redhat-телеметрия стартует в `activate`);
- `languages.registerDocumentPasteEditProvider` (proposed API, расширение его
  использует для `java.updateImportsOnPaste`), `registerDocumentSemanticTokensProvider`
  — нужны хотя бы no-op'ами.

### №7. Что не заработает никогда (by design)

- `contributes.customEditors` — редактор настроек форматтера (`java.formatter.settings`);
- `createWebviewPanel` × 3 — markdown-превью документации («Learn more about Clean Ups»),
  диалог Change Signature, «dashboard»;
- всё из Extension Pack for Java поверх `javaExtensions`: отладка
  (`vscode.debug`), тесты (Test API), вид «Java Projects» (TreeView) — это отдельные
  расширения и отдельные большие поверхности API.

### №8. Возможности jdt.ls, которые сервер отдаёт, а UI у нас нет

Сервер анонсирует и умеет: semantic tokens, inlay hints, code lens (счётчик
ссылок), document symbols (Outline), workspace symbols (Ctrl+T), call/type
hierarchy, rename, selection range, on-type formatting. У нас соответствующие
`register*Provider` — no-op (таблица в [LSP.md](LSP.md)), т.е. Java получит их
автоматически по мере закрытия этих строк — отдельной работы «под Java» не нужно.

## Прочие наблюдения из прогонов

- **Lombok-агент дефолтом включён** (`java.jdt.ls.lombokSupport.enabled: true`) и в
  этой комбинации (jdt.ls 1.57 + JDK 21) **ломает компиляцию**: `Lombok can't parse
  this source: NoSuchFieldError ... ConstructorDeclaration.constructorCall`, вместо
  диагностик — «Internal compiler error». Лечится `false`; это дефект
  lombok/JDT, не наш, но кандидат в курируемые дефолты. Важная деталь: после
  первого запуска настройка не подхватилась, пока не пересоздался `jdt_ws` —
  состояние сервера кэшируется вместе с AppCDS-архивом `jdtls.jsa`.
- **Время до первой диагностики** на игрушечном проекте (тёплые кэши):
  активация → готовность ≈ 19 с (maven и gradle одинаково). Первый запуск дольше:
  maven тянет деп в `~/.m2`, gradle — дистрибутив 9.7.1 в `~/.gradle`.
- Конфиг-дефолты из `contributes.configuration` доезжают в расширение штатно
  (≈250 ключей `java.*` в `configDefaults`), пользовательский слой их
  перекрывает — механизм #305 сработал без правок.
- В логе за весь прогон **нет ни одной ошибки конвертации** в `client.outputChannel` —
  классов-ловушек (как `CompletionList` у ts-сервера) у этого клиента не всплыло.

## Порядок работ (исходный план; пункты 1–6 выполнены)

1. ~~`workspaceContains:` (+`onCommand:`) в активации~~ — #359.
2. ~~Не падать на не-`file:` URI, затем виртуальные документы через
   `registerTextDocumentContentProvider`~~ — #363.
3. ~~Storage-каталоги в `ExtensionContext`~~.
4. ~~`setContext` → context keys; `createStatusBarItem` + `StatusBarAlignment`~~.
5. ~~Добор `workspace.fs`, `workspace.findFiles`, `env.*`~~ — этот PR. Заодно
   заглушка `registerCustomEditorProvider` (дыра №7: редактор настроек
   форматтера). `registerDocumentPasteEditProvider` отдельно не понадобился —
   расширение просит его как proposed API и живёт без него.
6. ~~Диалоги с кнопками и `showQuickPick`/`showInputBox`~~ — #352 и узел n-8.
   Из двух курируемых дефолтов взят только `lombokSupport.enabled: false`:
   `updateBuildConfiguration` оставлен эталонным (`"interactive"`), потому что
   вопрос «Synchronize now / Never» у нас теперь отвечаем, и подменять его
   значило бы молча забрать у человека решение, которое оставляет VS Code.
7. Запись в реестр магазина — платформенные vsix (с JRE) + `universal`, гейт
   `engines.diode`. **Открыто.**
