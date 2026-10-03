# Lifecycle (`IDisposable` / `Disposable` / `DisposableStore`) — где живёт примитив

Статус: **в работе** — план из раздела 9, PR 1–4. PR 1 (примитив
`src/vs/base/common/lifecycle.ts`) — #386, PR 2 (кодмод импортов) — влит. Документ отвечает на вопрос «кому
должен принадлежать примитив жизненного цикла и во что обойдётся его переезд».

База исследования — `19df1033` (main на 03.10.2026), tuidom — `e91f183`
(релиз 0.5.0), эталон — `/workspaces/vscode`, `src/vs/base/common/lifecycle.ts`.

Соседние исследования той же группы: [Events](Events.md) (Emitter/Event) и
[FileService](FileService.md). Их темы здесь не разбираются — только стыки.

---

## 1. Короткий ответ

- **Примитив надо забрать к себе: `src/vs/base/common/lifecycle.ts`.** Самый
  нижний кирпич проекта сегодня принадлежит пакету UI-движка, и 148 наших файлов
  ходят за ним в `@tuidom/core`.
- **Главная находка: движку этот класс не нужен.** В репозитории tuidom
  `class Disposable` не наследует **ни один** класс, а `IDisposable` упомянут в
  трёх файлах (контракт `ITerminalSurface`, его фейк и `TerminalViewElement`).
  `TUIElement` lifecycle-хука не имеет вовсе. То есть `Disposable` — это наш код,
  который при выносе движка уехал не в тот репозиторий.
- **Отсюда граница тривиальна.** Двух несовместимых базовых классов с одним
  именем не возникает: с нашей стороны ни один тип не объявлен как `Disposable`
  (класс используется только в `extends`), а через границу ходит только
  интерфейс `{ dispose(): void }`, совместимый структурно.
- **От tuidom для старта не нужно ничего** — ни PR, ни публикации версии.
  Удаление осиротевшего класса из движка — необязательная уборка «с ближайшим
  релизом».
- **Цена: 4 небольших PR** (примитив → кодмод импортов → гейт → учёт утечек в
  тестах) плюс необязательный долгий хвост замены самодельных мест. Кодмод —
  148 файлов, строго по одной строке импорта.
- **Порядок относительно Emitter:** сначала lifecycle (PR 1–2), потом
  [Events](Events.md) — у эталона `event.ts` стоит на `lifecycle.ts`, не наоборот.

---

## 2. Инвентаризация

Счётчики сняты скриптом по `import … from "@tuidom/…"` (многострочные импорты
учтены), «тест» — `*.test.ts`, `*testUtils*`, `src/TestUtils`, `e2e`.

### 2.1. Кто импортирует `@tuidom/core/common/disposable`

**148 файлов: 128 продовых + 20 тестовых.** Импортируются ровно два имени:
`IDisposable` (115 файлов) и `Disposable` (66 файлов; 66 классов `extends
Disposable` в 65 файлах). 82 файла берут только тип, 66 — класс.

| Зона | прод | тест | Примечание |
|---|---|---|---|
| `base/common` | 1 | 0 | `cancellation.ts` |
| `platform/*/common` | 21 | 0 | |
| `platform/*/node` | 7 | 3 | в т.ч. watcher-субпроцесс (`treeWatcherServer.ts`) |
| `editor/common` | 7 | 0 | |
| `workbench/api/common` | 10 | 0 | код extension-host-субпроцесса |
| `workbench/api/browser` | 6 | 0 | |
| `workbench/common` | 2 | 1 | |
| `workbench/services/*/common` | 11 | 1 | |
| `workbench/services/*/node` | 7 | 3 | |
| `workbench/services/*/browser` | 7 | 2 | |
| `workbench/contrib/*/{common,node}` | 4 | 0 | |
| `workbench/contrib/*/browser` | 29 | 5 | |
| `workbench/browser` | 16 | 3 | в т.ч. база компонентов `component.ts` |
| `src/TestUtils` | 0 | 2 | |

Сверка с цифрами родительского аудита: «~136 импортов» — на деле 148 файлов;
`platform` — 28 продовых (+3 теста), а не 29; `editor/common` — 7 ✔;
`base/common` — 1 ✔; `workbench/api` — 16 ✔. «9 файлов `editor/common`
импортируют `@tuidom`» — на деле 8 продовых (7 с `disposable`, из них два берут
ещё и `DisplayLine`/`measureTextWidth`, плюс `lineBreaksComputer.ts`); девятый —
тест-хелпер `editor/test/common/trackDSL.ts`.

**77 из 128 продовых файлов лежат вне `browser`** — в `common`/`node`, то есть в
коде, которому движок рендера по смыслу не нужен.

Оговорка про субпроцессы: бандл один (`tsup`, вход `src/vs/diode/main.ts`,
`splitting: false`), extension host и watcher — тот же `main.js` с другим
режимом запуска. Поэтому «субпроцесс тянет пакет рендера» — утверждение про
**граф модулей**, а не про рантайм: сам `disposable.ts` ничего не импортирует, и
его переезд ни байта, ни миллисекунды не сэкономит. Выигрыш — архитектурный:
`workbench/api/common`, `workbench/services/*/common` и `platform/*/node` после
переезда не импортируют `@tuidom` **вообще** (сейчас `disposable` — их
единственный импорт в движок).

### 2.2. Что есть в движке

`packages/core/src/common/disposable.ts` — 24 строки: интерфейс и класс с
`protected register()` и идемпотентным `dispose()` (LIFO). Нет `DisposableStore`,
`MutableDisposable`, `toDisposable`, учёта утечек. Три свойства, важные для
переезда:

- `register()` после `dispose()` молча кладёт объект в массив — он уже никогда
  не освободится;
- исключение в одном `dispose()` обрывает освобождение остальных;
- поля `private` — класс номинальный: одноимённый класс с нашей стороны ему
  не присваиваем (на практике это ни на что не влияет, см. раздел 5).

Использование внутри tuidom: `extends Disposable` — **0**; `IDisposable` —
`core/common/iTerminalSurface.ts` (тип возврата `onUpdate`/`onExit`),
`testing/FakeTerminalSurface.ts`, `elements/terminal/terminalViewElement.ts`
(поле `subscriptions: IDisposable[]`).

### 2.3. Самодельные места в diode (продовый код `src/vs`)

| Паттерн | Сколько | Чем заменяется |
|---|---|---|
| литерал `{ dispose: () => … }` | 168 в 95 файлах | `toDisposable(fn)` |
| константа-пустышка `{ dispose: () => undefined }` | 16 в 13 файлах | `Disposable.None` |
| поле/переменная `IDisposable[]` + ручной цикл | 7 в 6 файлах (+10 циклов `for … x.dispose()`) | `DisposableStore` |
| `Map<…, IDisposable>` с ручным снятием | 8 в 6 файлах | `DisposableMap` |
| `x?.dispose()` (слот «текущая подписка») | 72 в 35 файлах — верхняя граница, не всё из этого слоты | `MutableDisposable` |
| класс со своим `dispose()` без базового класса | 18 | `extends Disposable` там, где есть что регистрировать |
| `this.register(…)` | 186 в 80 файлах | остаётся как есть |

Примеры (по одному на паттерн):

- **Слоты.** `workbench/browser/parts/editor/editorStatusContribution.ts` — пять
  полей `cursorHandle`/`indentationHandle`/`encodingHandle`/`eolHandle`/
  `languageHandle`, каждое снимается руками через `?.dispose()`, плюс массив
  `editorSubscriptions`. Это один `DisposableStore` «на активный редактор» в
  `MutableDisposable`. То же в `services/textfile/common/textFileModel.ts`
  (`languageSubscription`, `eolSubscription`, `contentSubscription`,
  `fileWatch` — 8 вызовов `?.dispose()` в двух местах).
- **Карты.** `services/extensions/node/extensionHost.ts` — `proxyCommands`,
  `commandActivationStubs`, `fileWatchers` (три `Map<…, IDisposable>` с ручным
  `get(id)?.dispose()` и циклом на выходе); `api/browser/documentSyncAdapter.ts`
  — `tracked: Map<TextFileModel, { dispose(): void }>`.
- **Литералы.** `extensionHost.ts` — 13, `textFileModel.ts` — 10,
  `editorService.ts` — 8, `editorGroupModel.ts` — 7. Почти все — «отписка
  из массива слушателей», и большую часть заберёт не `toDisposable`, а Emitter
  (см. [Events](Events.md)): считать их дважды не надо.
- **Пустышки.** `platform/files/common/iFileSystemProviderRegistry.ts` (3),
  `base/common/cancellation.ts` (`NO_SUBSCRIPTION`), null-реализации в
  `workbench/api/common/i*.ts`.

### 2.4. `DisposableImpl` в API расширений — отдельная сущность

`workbench/api/common/vscodeTypes.ts` держит `DisposableImpl` — реализацию
`vscode.Disposable` для расширений: 37 упоминаний в 7 файлах и 29 приведений
`as unknown as vscode.Disposable`. Причина приведений — поле
`private readonly callOnDispose`: приватный член делает класс номинально
несовместимым с декларацией из `vscode.d.ts`.

У эталона это тоже **отдельный** класс (`workbench/api/common/extHostTypes.ts`,
`class Disposable` с `#callOnDispose`), не имеющий отношения к
`base/common/lifecycle.ts`: внутренний примитив и публичный тип API живут
порознь. Так и оставляем. Приведения лечатся локально (хранить колбэк так,
чтобы у класса не было объявленных приватных членов) и к переезду lifecycle не
привязаны — пункт в разделе 8.

---

## 3. Как сделано в vscode

`src/vs/base/common/lifecycle.ts`, 974 строки. Экспорты по группам:

| Группа | Что | Нужно ли нам |
|---|---|---|
| Ядро | `IDisposable`, `isDisposable`, `dispose(x \| Iterable)`, `toDisposable`, `combinedDisposable`, `Disposable` (с `Disposable.None`, `_store`, `_register`), `DisposableStore` (`add`/`delete`/`clear`/`isDisposed`) | да, всё |
| Слоты и коллекции | `MutableDisposable` (`value`, `clear`, `clearAndLeak`), `DisposableMap`, `DisposableSet` | `MutableDisposable`, `DisposableMap` — да; `DisposableSet` — по первой надобности |
| Учёт утечек | `IDisposableTracker`, `DisposableTracker`, `GCBasedDisposableTracker`, `setDisposableTracker`, `trackDisposable`, `markAsDisposed`, `markAsSingleton`, `setParentOfDisposable` (не экспортируется) | трекер и хуки — да; GC-вариант — нет |
| Ссылки со счётчиком | `RefCountedDisposable`, `IReference`, `ReferenceCollection`, `AsyncReferenceCollection`, `ImmortalReference` | нет (понадобится для модели «текстовая модель по ссылке» — тема [FileService](FileService.md)) |
| Разное | `MandatoryMutableDisposable`, `disposeOnReturn`, `thenIfNotDisposed`, `thenRegisterOrDispose`, `DisposableResourceMap`, `disposeIfDisposable` | нет |

Свойства эталона, которые стоит перенять:

- `Disposable` — тонкая обёртка над `DisposableStore`; вся механика в сторе.
- `dispose(iterable)` освобождает **все** элементы и бросает `AggregateError`,
  если кто-то упал, — один сбойный `dispose` не оставляет остальных висеть.
- `DisposableStore.add` в уже освобождённый стор печатает предупреждение со
  стеком (объект при этом **утекает** — у эталона так).
- Учёт утечек — глобальный трекер, по умолчанию `null`: `trackDisposable(this)`
  в конструкторах превращается в одну проверку. В тестах
  `ensureNoDisposablesAreLeakedInTestSuite()` (`base/test/common/utils.ts`)
  ставит трекер в `setup`, а в `teardown` валит тест, если остались живые
  корни; вызов стоит в начале более чем 2000 тестовых файлов эталона.
  Родство объектов (`setParentOfDisposable`) позволяет считать утечкой только
  корень, а не всё поддерево; `markAsSingleton` выводит из учёта синглтоны.

Зависимости `lifecycle.ts` у эталона: `arrays`, `collections`, `map`, `uri`,
`functional`, `iterator`, `errors`. Почти все нужны только трекеру (группировка
отчёта) и `DisposableResourceMap`. Ядро зависит лишь от `errors`.

**Дословный перенос не предлагается.** В отличие от diff-движка (импорт
скриптом, правки запрещены), это 150–250 строк собственного кода в стиле шимов
`base/common`: наши имена (`register`, без подчёркиваний — правило AGENTS.md),
наши тесты, храповик покрытия и мутаций. Дословный файл потянул бы шесть шимов
ради функций, которые нам не нужны.

---

## 4. Варианты размещения

### (а) Свой `src/vs/base/common/lifecycle.ts` — рекомендуется

Примитив становится нашим кодом в самом нижнем слое. tuidom оставляет у себя
трёхстрочный интерфейс `IDisposable` для своих контрактов.

- **Цена у нас:** файл + тесты (PR 1), кодмод 148 импортов (PR 2), правило в
  гейте (PR 3). Заодно закрывается пункт «`disposable.ts`→`lifecycle.ts`» из
  [VscodeStructureFollowUps](VscodeStructureFollowUps.md) — переименование
  происходит само собой.
- **Цена в tuidom:** для старта — **ноль**. После PR 2 класс `Disposable` в
  движке не использует никто; его удаление — один маленький PR в tuidom
  (ломающий для внешних потребителей, но пакет в 0.x и объявлен нестабильным).
  Отдельной публикации ради этого не нужно — уедет с ближайшим релизом; diode
  на этот релиз не завязан.
- **Плюсы:** новые примитивы и трекер добавляются одним PR у нас, без цикла
  «PR в движок → запрос публикации у человека → bump»; правило «`base/common`
  не импортирует ничего из проекта» становится правдой по существу; нижние слои
  перестают зависеть от пакета рендера.
- **Минусы:** в двух репозиториях есть по интерфейсу `IDisposable`. Они
  структурно тождественны, расхождение невозможно, пока это `{ dispose(): void }`.

### (б) Leaf-пакет, общий для tuidom и diode

Например `@tuidom/lifecycle`: седьмой пакет монорепозитория движка, от которого
зависят и `@tuidom/core`, и diode.

- **Цена в tuidom:** новый пакет, его сборка/упаковка в tgz, место в релизном
  цикле (публикация строго tgz, OIDC), запрос публикации у человека. Движку из
  пакета нужен один интерфейс в три строки.
- **Цена у нас:** тот же кодмод 148 импортов + новая зависимость в
  `package.json` и `noExternal` в `tsup.config.ts`.
- **Главный минус:** каждое расширение примитива (стор, слот, трекер, правка
  поведения) — PR в чужой репозиторий и новая версия в npm с ожиданием
  человека. Мы собираемся активно менять этот файл (разделы 6–7), а движок его
  не использует.
- **Риск:** трекер утечек — глобальное состояние. Две копии пакета в
  `node_modules` (разные версии у `@tuidom/core` и у diode) дают два трекера,
  и учёт молча теряет половину объектов.

Вариант оправдан, только если движок сам начнёт строить на классе `Disposable`.
Сейчас этого нет.

### (в) Оставить как есть и узаконить

Записать в ARCHITECTURE.md, что `@tuidom/core/common/*` — «общие примитивы
платформы», и нижним слоям их можно.

- **Цена сейчас:** ноль.
- **Цена дальше:** та же, что у (б), но хуже — примитив, которым движок не
  пользуется, развивается в репозитории движка, а его критерий принадлежности
  («живёт там ⇔ не упоминает понятий Diode») формально выполнен и по существу
  пуст: это мёртвый для движка код. Учёт утечек потребует глобального хука в
  пакете рендера ради наших тестов.

### Сводка

| | (а) свой файл | (б) leaf-пакет | (в) как есть |
|---|---|---|---|
| PR в tuidom до старта | 0 | 1 (новый пакет) | 0 |
| Публикация версии до старта | нет | да | нет |
| Публикация на каждое расширение примитива | нет | да | да |
| Кодмод импортов у нас | 148 файлов | 148 файлов | 0 |
| Нижние слои свободны от пакета рендера | да | да | нет |

**Рекомендация — (а).**

---

## 5. Совместимость классов: где проходит граница

Опасение было такое: элементы tuidom наследуют свой `Disposable`, наш код —
свой, и появляются два несовместимых базовых класса с одним именем. Проверка
показала, что почвы для него нет:

1. **Элементы tuidom `Disposable` не наследуют.** Ни один класс движка. У
   `TUIElement` нет ни `dispose`, ни хука отсоединения (это прямо записано в
   `docs/arch/TUIDom.md` движка: «`TUIElement` не имеет lifecycle-хука»).
2. **С нашей стороны `Disposable` не используется как тип.** Поиск аннотаций
   `: Disposable`, `<Disposable>`, `instanceof Disposable` по `src/vs` — пусто.
   Класс встречается только в `extends`. Значит, после кодмода нет места, где
   встретились бы два класса.
3. **Через границу ходит только интерфейс.** Единственный контракт движка с
   `IDisposable` — `ITerminalSurface.onUpdate/onExit`. Его реализует наш
   `EmbeddedTerminalSession`, возвращая объект с `dispose()`; структурной
   совместимости достаточно, чей интерфейс написан в аннотации — неважно.

Граница после переезда: **наш код импортирует lifecycle только из
`vs/base/common/lifecycle.ts`**; импорт `@tuidom/core/common/disposable` из
`src/` запрещён гейтом (PR 3) — именно это правило, а не дисциплина, не даёт
двум классам сосуществовать. Тип, пришедший из сигнатуры движка, принимается
как наш `IDisposable` без приведений.

Если движку когда-нибудь понадобится собственный жизненный цикл элементов
(detach-хук у `TUIElement`) — это будет его механика со своим именем; с нашим
классом её свяжет тот же структурный `dispose()`.

### Поведение, которое меняется при переезде

Класс из движка и класс эталона ведут себя по-разному в трёх местах. Решение по
каждому — чтобы кодмод остался чисто механическим:

| Вопрос | tuidom сейчас | vscode | Предложение |
|---|---|---|---|
| Порядок освобождения | LIFO | порядок вставки (`Set`) | **оставить LIFO** — 66 классов писались под него; осознанное отклонение от эталона, записать в шапке файла |
| `register` после `dispose` | молча копит | предупреждение, объект утекает | в PR 1 — паритет с tuidom; затем отдельным PR: освобождать сразу и сообщать трекеру |
| Исключение в чужом `dispose` | обрывает остальных | освобождает всех, `AggregateError` | как у vscode — строго безопаснее, ни один вызов не начнёт вести себя хуже |

---

## 6. Какие примитивы нужны и что они заменят

Нужный набор и оценка по инвентаризации 2.3:

| Примитив | Заменяет | Оценка объёма |
|---|---|---|
| `toDisposable(fn)` | литералы `{ dispose: … }` | до 168 мест в 95 файлах; **реально меньше** — отписки из массивов слушателей уйдут в Emitter |
| `Disposable.None` | 16 констант-пустышек | 13 файлов, включая `NO_SUBSCRIPTION` в `cancellation.ts` |
| `DisposableStore` | `IDisposable[]` + цикл; «стор на эпизод» | 6 файлов с массивами; главный потребитель — эпизодные времена жизни (ниже) |
| `MutableDisposable` | поле-слот + `?.dispose()` | до 35 файлов; уверенно — `editorStatusContribution`, `textFileModel`, `scmStatusBarContribution`, `keyboardDoctorComponent`, `dialogService`, `diffEditorPane2` |
| `DisposableMap` | `Map<K, IDisposable>` | 6 файлов (9 карт с `documentSyncAdapter`) |
| `combinedDisposable` | «вернуть одну ручку на две подписки» | единицы; нужен Emitter-слою |
| `dispose(iterable)`, `isDisposable` | циклы освобождения; освобождение сервисов контейнером | основа для стора и для `Container.dispose()` |

Чего набор даёт сверх замены один-к-одному — **время жизни короче времени жизни
владельца**. Сегодня у класса один список на всю жизнь (`this.register`), и всё,
что живёт меньше, ведётся руками или не ведётся:

- extension host при респавне субпроцесса копит `this.register(…)` на время
  жизни хоста, а не спавна — нужен стор на спавн;
- `editorStatusContribution` и панели редактора — стор на активный редактор;
- `bindDocumentSync` возвращает `void`: и подписки на группу, и карта подписок
  на модели не имеют владельца — должен возвращать `IDisposable`.

Не берём: ссылки со счётчиком, `DisposableSet`, `MandatoryMutableDisposable`,
промис-хелперы — потребителей нет.

---

## 7. Учёт утечек

**Стоит, но как opt-in на сьют, а не глобально.**

Что переносим: глобальный трекер (по умолчанию `null`), `trackDisposable` /
`markAsDisposed` / родство в конструкторах стора, `Disposable`,
`MutableDisposable`, `DisposableMap` и `toDisposable`, `markAsSingleton`.
В проде стоимость — одна проверка на `null` на объект.

Как подключаем в тестах: хелпер `ensureNoDisposablesAreLeakedInTestSuite()` в
`src/TestUtils` на `beforeEach`/`afterEach` vitest; возвращает стор для объектов
самого теста; упавший тест утечки не проверяет (как у эталона).

Почему не глобальный `setupFiles`:

- **Сразу станет красным.** Известные неосвобождаемые владельцы (раздел 10)
  протекут в сотнях из 812 тестовых файлов.
- **Сначала слепой, потом шумный.** Трекер видит только объекты, созданные
  через примитивы. 168 литералов `{ dispose }` для него невидимы, пока не
  заменены на `toDisposable`; зелёный сьют до этой замены ничего не доказывает.
- **Цена на слабой машине.** Трекер эталона снимает `new Error().stack` на
  каждый объект. На полном прогоне это заметные CPU-минуты; на отдельных
  сьютах — нет.

Порядок включения — храповиком снизу вверх: тесты самого `lifecycle.ts` →
сьюты `base/common` и `platform/*` → сервисы `workbench/services/*/common` →
дальше по мере замены самодельных мест. Каждый включённый сьют остаётся
включённым. Цели «включить везде» не ставим.

Синглтоны уровня процесса (реестры, созданные при импорте модуля) помечаются
`markAsSingleton` — иначе первый же сьют, импортировавший модуль, «утечёт».

---

## 8. Что ещё нижние слои берут из `@tuidom` и нужен ли гейт

Полный список импортов движка вне `browser`-окружения (продовый код, без
`disposable`):

| Файл | Что берёт | Характер |
|---|---|---|
| `base/common/fileIcons.ts` | `packRgb` из `core/common/colorUtils` | значение, чистая функция |
| `base/common/listRowId.ts` | `TUIElement` | **только тип**, но файл в `common` про UI-элемент |
| `platform/theme/common/colorUtils.ts` | `parseHexColor` | значение, чистая функция |
| `platform/contextview/common/contextMenuDelegate.ts` | `TUIElement`, `OverlayAnchorPosition`, `MenuEntry` | только типы |
| `platform/actions/common/menuRegistry.ts`, `menuService.ts` | `MenuEntry` и др. из `@tuidom/elements/menu` | только типы; модель меню описана типами виджета |
| `editor/common/viewModel/editorViewState.ts`, `lineBreaksComputer.ts` | `DisplayLine` | значение: ширины/графемы |
| `editor/common/viewModel/lineWidthCache.ts` | `measureTextWidth` | значение |
| `workbench/common/coreTokens.ts` | `ITerminalBackend`, `TuiApplication` | только типы (DI-токены) |
| `workbench/contrib/keyboardDoctor/common/keyboardDoctorModel.ts` | `tokenize`, `RawTerminalToken` из `core/input` | значение, чистый парсер |
| `workbench/contrib/terminal/common/terminalSessionFactory.ts`, `xtermPalette.ts` | `ITerminalSurface`, `packRgb` | тип + чистая функция |
| `workbench/contrib/terminal/node/embeddedTerminalSession.ts` | `colorUtils`, `iTerminalSurface`, `styleFlags` | значения из `core/common` |
| `workbench/services/terminalEnvironment/node/*` | `terminal-backend/terminalEnv`, `ITerminalBackend` | node-значение + тип |

Наблюдения:

- **Значения берутся только из `@tuidom/core/common/*` и `core/input/*`** —
  чистого, не-DOM среза движка (геометрия, цвет, Unicode-ширины, разбор ввода),
  плюс node-пакет `terminal-backend` из node-кода. Ни один `common`/`node`-файл
  не тянет **значение** из `core/dom`, `core/rendering` или `@tuidom/elements`.
- Всё, что пересекает слой «не туда», — **типы** (`TUIElement`, `MenuEntry`,
  `TuiApplication`). Гейт их игнорирует по построению (`import type`, как
  upstream `layersChecker`).
- Измерение текста в `editor/common` — законная зависимость: ширина графемы в
  терминале и есть «метрики шрифта» нашего браузера. Переносить `DisplayLine` к
  себе не нужно и нельзя (копирование кусков движка запрещено AGENTS.md).

**Гейт нужен** — сейчас `scripts/check-layers.mjs` смотрит только относительные
импорты, и для него `@tuidom/*` невидим целиком. Предлагаемое правило —
разметить подпути движка той же осью окружений, что и наш код:

| Подпуть | Окружение |
|---|---|
| `@tuidom/core/common/*`, `@tuidom/core/input/*` | `common` |
| `@tuidom/core/{dom,rendering,backend}/*`, `@tuidom/elements/*`, `@tuidom/inspector/*` | `browser` |
| `@tuidom/terminal-backend/*`, `@tuidom/headless-backend/*` | `node` |
| `@tuidom/testing/*` | только тесты |
| `@tuidom/core/common/disposable` | **запрещён везде** (после PR 2) |

Плюс одно правило по вертикали: `base/common` не импортирует значений из
`@tuidom` вовсе. По сегодняшнему коду это даёт **одно** нарушение
(`fileIcons.ts` → `packRgb`), которое заносится в `EXCEPTIONS` либо чинится
переносом цветовой части иконок выше. Остальное проходит без исключений — гейт
фиксирует уже достигнутое состояние и не даёт ему расползтись.

Типовые протечки (модель меню в `platform/actions/common` на типах виджета,
`listRowId.ts` в `base/common` на `TUIElement`) гейтом не ловятся и к lifecycle
не относятся — записаны в «Не делаем».

---

## 9. План

| PR | Что | Размер | Риски |
|---|---|---|---|
| **1. Примитив** | `src/vs/base/common/lifecycle.ts`: `IDisposable`, `isDisposable`, `dispose()`, `toDisposable`, `combinedDisposable`, `DisposableStore`, `Disposable` (+`None`), `MutableDisposable`, `DisposableMap`; хуки трекера заложены, трекер `null`. Тесты, ARCHITECTURE.md, `arch/Common.md` | малый | Новый файл обязан выйти на 100% покрытия и пройти мутационный гейт — закладывать на тесты больше, чем на код. Поведение — по таблице раздела 5 |
| **2. Кодмод импортов** | 148 файлов: `@tuidom/core/common/disposable` → относительный путь к `lifecycle.ts`, одна строка на файл. Скрипт разовый, в репозиторий не кладётся | малый по смыслу, широкий по диффу | (1) Конфликты с параллельными ветками — вливать быстро, в тихое окно. (2) Скоуп мутаций считается по строкам ([MutationDebtAfterLintSweep](MutationDebtAfterLintSweep.md)): дифф держать строго в строках импорта, без попутного форматирования, и до пуша посмотреть, что `mutation-diff.mjs` даёт пустой скоуп. (3) `lint:fix` пересортирует импорты — это ожидаемо и остаётся в тех же строках |
| **3. Гейт** | `check-layers.mjs`: разметка подпутей `@tuidom` по окружениям, запрет `…/common/disposable`, `base/common` без значений из движка. Обновить описание «браузера» в ARCHITECTURE.md | малый | Одно исключение (`fileIcons.ts`) с записью в [VscodeStructureFollowUps](VscodeStructureFollowUps.md) |
| **4. Учёт утечек** | `DisposableTracker`, `markAsSingleton`, тест-хелпер; включить на сьютах `lifecycle` и первых нескольких `base`/`platform` | малый | Не включать глобально (раздел 7) |
| **5. tuidom (необязательно)** | Удалить `class Disposable` из `@tuidom/core`, оставить интерфейс | крошечный, в репозитории движка | Ломающее изменение публичного пакета; уезжает с ближайшим релизом, отдельной публикации не просим |
| **6+. Замена самодельных мест** | По одному владельцу на PR, вместе с задачей, которая этот код и так трогает: стор на спавн в `extensionHost`, `MutableDisposable` в `editorStatusContribution`/`textFileModel`, `DisposableMap` в картах подписок, `Disposable.None` вместо пустышек | долгий хвост | Каждая замена меняет порядок/момент освобождения — нужен тест на наблюдаемое поведение, а не на факт вызова `dispose` |

PR 1 и PR 2 можно слить в один, если ревью удобнее видеть примитив вместе с
первым потребителем; порознь безопаснее для мутационного гейта.

### Порядок относительно Emitter ([Events](Events.md))

1. **PR 1 — до Emitter.** `event.ts` эталона импортирует из `lifecycle.ts`
   `IDisposable`, `Disposable`, `DisposableStore`, `DisposableMap`,
   `toDisposable`, `combinedDisposable` (подписка возвращает `IDisposable`,
   третий аргумент — стор) — ровно набор PR 1. Обратной зависимости нет.
2. **PR 2 — тоже до.** Оба кодмода проходят по одним и тем же файлам (почти
   каждый файл с `onDidX(listener): IDisposable` импортирует `disposable`).
   Наш — однострочный; если он влит первым, миграция Emitter конфликтует с ним
   нулём строк, наоборот — сотней.
3. **Массовую замену литералов `{ dispose }` на `toDisposable` не делать до
   Emitter.** Большая часть из 168 — тела ручных подписок; Emitter удалит их
   целиком. Заменять имеет смысл только остаток.
4. **PR 4 выгоднее после первых шагов Emitter** (но не зависит от них):
   подписка Emitter эталона возвращает `toDisposable(…)`, то есть попадает в
   трекер сама, и учёт утечек начинает видеть слушателей без ручной работы.

---

## 10. Попутные находки (не чиним в рамках этой темы)

- `EditorElement` (`editor/browser/editorElement.ts`) не имеет `dispose`: три
  подписки на `viewState`/документ в конструкторе выбрасываются.
- `bindDocumentSync` (`workbench/api/browser/documentSyncAdapter.ts`) возвращает
  `void` — подписки на группы и модели снять нельзя.
- `ViewsService` не `Disposable`.
- `ExtensionHost` при респавне субпроцесса регистрирует подписки в список
  времени жизни хоста.
- `Container` (`platform/instantiation/common/diContainer.ts`) не имеет
  `dispose` и порядка освобождения сервисов — созданные сервисы живут до конца
  процесса.
- `DisposableImpl.dispose()` не идемпотентен (у эталона колбэк обнуляется после
  первого вызова); 29 приведений `as unknown as vscode.Disposable` вызваны
  приватным полем класса.
- `Disposable.register()` из tuidom после `dispose()` молча копит объект.
- `TerminalViewElement` в движке держит подписки сам и полагается на то, что
  владелец вызовет `dispose()` — у `TUIElement` нет хука отсоединения.

---

## 11. Что НЕ делаем

- **Не переносим `lifecycle.ts` дословно** и не тянем его шимы (`collections`,
  `functional`, `iterator`).
- **Не вводим leaf-пакет** и не узакониваем нынешнюю зависимость.
- **Не объединяем** внутренний `Disposable` с `DisposableImpl` API расширений.
- **Не трогаем `DisplayLine`/`measureTextWidth`/`colorUtils`** — они остаются
  в движке и легальны для `common`-кода через гейт.
- **Не чиним типовые протечки движка в нижние слои** (`MenuEntry` в
  `platform/actions/common`, `TUIElement` в `base/common/listRowId.ts` и
  `platform/contextview/common`) — отдельная тема; кандидат на запись в
  [VscodeStructureFollowUps](VscodeStructureFollowUps.md).
- **Не делаем `Container.dispose()`** и lifecycle-хук у `TUIElement` в этих PR:
  первое — тема DI, второе — задача репозитория tuidom.
- **Не включаем учёт утечек глобально** и не ставим цель «ноль утечек».
- **Не меняем `register` на `_register`** — правило проекта про приватные имена
  важнее побуквенного совпадения с эталоном.

## Открытые вопросы

1. `register` после `dispose`: освобождать сразу (безопаснее) или, как у
   эталона, предупреждать и оставлять? Рекомендация — освобождать сразу,
   отдельным PR после кодмода.
2. Удалять ли `class Disposable` из tuidom вообще (PR 5) или оставить как
   удобство внешним потребителям движка — решение владельца tuidom.
3. Слить ли PR 1 и PR 2.
