# Виджеты над редактором

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).

Попапы и док-виджеты над активным редактором устроены формой «владелец виджета»
([../Workbench.md](../Workbench.md#три-формы-пары)): сервис фичи командует компонентом-виджетом.

## Попап у каретки

- `parts/editor/caretAnchoredOverlay.ts` — `CaretAnchoredOverlay`: попап у
  каретки редактора (аналог upstream `IContentWidget`) — overlay-сессия с
  опциями, общими для suggest/hover/parameter hints (фокус не забирает,
  `capturesKeyboard: false`, клик мимо закрывает), и размещение `"below"` /
  `"aboveElseBelow"` (`ContentWidgetPositionPreference`). Компоненты попапов
  содержат его полем, хост — `LayoutService.mainContainer`.

## Find

- `contrib/find/browser/findComponent.ts` — `Component`; **композиционный
  корень**, собранный из примитивов (`view` = `SizedBoxElement`(preferredWidth×3)
  → `BoxContainerElement` → `HFlexElement` со строкой запроса `InputElement`,
  счётчиком совпадений и кнопками ↑ ↓ ✕ `ButtonElement`; `view.id = "findWidget"`).
  Ручного рендера нет — рамку/фон/раскладку дают примитивы, цвета из темы через
  `getFindWidgetStyles` (`editorWidget.*` + счётчик `descriptionForeground` +
  «No results» `editorError.foreground`; кнопки из `getDialogButtonStyles`).
  Дерево строится ОДИН раз в конструкторе и мутируется на месте (`setCounter`/
  `setQuery` меняют только текст/цвет счётчика и его зазор) — строка запроса
  никогда не переподключается к дереву и не теряет фокус между нажатиями.
  Публичная поверхность для `FindService` — на самом компоненте
  (`getQuery`/`setQuery`/`setCounter`/`focus` + колбэки `onQueryChange`/`onNext`/
  `onPrev`/`onClose`), а не на `view`. Overlay-сессия — в ЛОКАЛЬНОМ слое группы
  редакторов (`pointerPolicy: "passthrough"` — док-виджет, клики мимо уходят в
  редактор); хост (`OverlayHostElement` группы) `FindComponent` берёт у полосы групп
  (`EditorPartComponent.groupOverlayHost`, зависимость DI) при первом Ctrl+F в группе. `show()` позиционирует
  виджет (правый край группы с 1-колоночным отступом, под tab strip) и фокусирует input.
- `contrib/find/browser/findService.ts` — состояние поиска query → matches → current
  index: `open` (сеет запрос из однострочного выделения), `close` (курсор
  остаётся на текущем совпадении, подсветка снимается), `next`/`prev`
  (циклично), recompute по `onQueryChange` (стартовый индекс — первое
  совпадение от курсора); подсветка/reveal — `setSearchDecorations`/
  `revealRange` активного `TextEditorPane`. Смена активного редактора закрывает
  виджет (подписка на `onActiveEditorChanged` — find оперирует только
  активным редактором). На документе с диска проход идёт фоном порциями
  (`BackgroundFind`, счётчик «Searching…»/«N of M…», кап 19 999, Next/Prev за капом ищут по документу) —
  [Editor.md](../Editor.md#документ-на-диске).

## Suggest

- `contrib/suggest/browser/suggestComponent.ts` — компонент suggest-попапа; владеет
  `CompletionListElement` (`view.id = "suggestWidget"`; цвета — токены `editorSuggestWidget.*`
  каскадом) и overlay-сессией в глобальном body-слое
  (хост — `LayoutService.mainContainer`, сессия создаётся в конструкторе;
  `capturesKeyboard: false` — редактор сохраняет
  фокус, команды идут по `suggestWidgetVisible`; `close-on-outside`).
  `openAt(anchor)`/`setAnchor` — позиционирование у каретки
  (`TextEditorPane.getCaretAnchor`).
- `contrib/suggest/browser/completionService.ts` — логика автодополнения: `trigger()`
  (провайдеры из реестра `ILanguageFeaturesService.completionProvider` + word-based
  fallback `collectWordCompletions` из всех открытых редакторов), сессия
  попапа (живой `prefixRange`, re-filter по событию каретки, авто-suggest и
  триггер-символы по `onDidType` редактора — правка accept, undo и вставка
  набором не считаются, — с задержкой `autoSuggestDelayMs`; ответа провайдеров
  ждёт без срока, а запрос «в полёте» отменяет сам, когда каретка ушла из
  слова, — `cancelRequestIfCaretLeft`),
  accept (замена префикса/провайдерского range с догоном каретки;
  `item.command` исполняется напрямую через `CommandRegistry.execute` в
  микротаске), делегаторы select*/accept/hide для команд, `onFocusChanged`
  (зовёт `WorkbenchContextKeys.handleFocusChange` при смене фокуса —
  клавиатурный уход с редактора закрывает попап).
- **Панель описания приезжает асинхронно** (`resolve`), уже после показа списка, а overlay-сессия
  запоминает геометрию на `openAt`: в дереве панель есть, в кадре — нет. Поэтому после смены
  содержимого сессия пере-анкорится (`SuggestComponent.refreshDetailsLayout`; `markDirty` на виджете
  не помогает), тот же путь — при сворачивании панели.

### Авто-открытие при наборе (quick suggest)

Приведено к эталону (`SuggestModel._doTriggerQuickSuggest`, `LineContext.shouldAutoTrigger`,
`_waitForInlineCompletionsAndTrigger`); код — `quickSuggestions.ts` + `CompletionService.doQuickSuggest`.

- **Слово, а не символ**: попап открывается, только если каретка в конце слова (или сразу за его первым
  символом) и слово не число; слово — `DEFAULT_WORD_REGEXP` эталона (пробел, скобка, `.`, `-`, `42`
  попап не открывают; кириллица — открывает). Языкового `wordPattern` нет.
- **Где — `editor.quickSuggestions`**: дефолт эталона — код `offWhenInlineCompletions`, комментарии и
  строки `off`. Вид токена — по TextMate-скоупам символа перед кареткой (`comment`/`string`,
  `meta.embedded` — снова код). Для `[json]`/`[jsonc]` строки включены `configurationDefaults`
  расширения `diode-settings`, иначе ключи settings.json не подсказывались бы.
- **Ничего не подошло — попапа нет**; авто-попап закрывается, когда добор отфильтровал список в ноль
  (неполный — перезапрашивается). Явный Ctrl+Space показывает полный список. **Отступление:** попап по
  триггер-символу ведёт себя как явный — наш префикс после символа включает его (`d.`: `WORD_CHAR`
  берёт точку ради ключей settings.json), и без провайдерского `range` не подошло бы ничего.
- **Задержка** — `editor.quickSuggestionsDelay` (10 мс); по триггер-символу — следующим тиком.
- **Уступает призраку**: в `offWhenInlineCompletions` при inline-провайдере и
  `editor.inlineSuggest.enabled` сначала ждёт исхода запроса призрака — показан → попапа нет, пусто →
  открывается, нет ответа 750 мс → открывается, а запрос призрака бросается. Плюс
  `editor.inlineSuggest.suppressSuggestions`, `editor.suggestOnTriggerCharacters`.
- **`editor.wordBasedSuggestions`** — пять режимов эталона; дефолт `offWithInlineSuggestions` = как
  `matchingDocuments`, гасит слова только при inline-провайдере И включённом Copilot
  (`github.copilot.enable`) — с Supermaven без Copilot слова остаются, как в vscode.
- Не сделано: режим `inline` (попап просто не открывает), провайдерский `suppressSuggestions`,
  `snippetsPreventQuickSuggestions`, retrigger при переходе к новому слову (`_onNewContext`).

## Подсказка параметров

Попап сигнатуры у каретки — contrib `parameterHints`: `ParameterHintsService`
(логика), `ParameterHintsComponent` (overlay-сессия), `ParameterHintsElement`
(рамка, счётчик перегрузок `1/2`, метка сигнатуры с подсветкой активного
параметра, описания под разделителем).

- **Провайдеры не склеиваются.** Реестр `ILanguageFeaturesService.signatureHelpProvider`
  обходится по очереди, берётся первый непустой ответ — так предписывает vscode API,
  и иначе было бы нечего делать с двумя разными `activeParameter`.
- **Триггер-символы объявляет сервер, а не ядро.** Они едут метаданными
  регистрации провайдера (`(`, `,`, `<` и ретриггер `)` у `typescript-language-server`),
  поэтому хардкода скобок в ядре нет, и дженерики работают бесплатно.
- **Жизнь при наборе.** Триггер — набор символа (`onDidType` редактора, как
  upstream), а не любая вставка: `(` с авто-закрытием пары и typeover `)`
  считаются набором, вставка блока — нет. Пока попап показан, правка и движение
  каретки перезапрашивают подсказку; ответ `null` закрывает попап (так его гасит
  закрывающая скобка). Задержка — `triggerDelayMs` (120 мс), устаревшее отбрасывает
  `LatestRequest`.
- **Выбранная перегрузка не сбрасывается**: в запрос уезжает эхо показанной
  подсказки (`activeSignatureHelp`), и сервер находит по нему прежнюю сигнатуру.
- **Перенос метки — со своими офсетами** (`signatureLayout.ts`): `wrapText` движка
  схлопывает пробелы, и подсветка после переноса уехала бы. Диапазон активного
  параметра — как в VS Code: пара офсетов как есть, строковая метка — по границе
  слова (голый `indexOf` подсветил бы `name` внутри `nameLength`).
- **Попап — над строкой каретки**, потому что suggest предпочитает низ, и у одной
  каретки они живут одновременно; нет места сверху — уходит вниз (тогда оба внизу).
- **Бинды.** Основной — аккорд Ctrl+K Ctrl+Space, канонический Ctrl+Shift+Space —
  вторым: на legacy он неотличим от Ctrl+Space (`triggerSuggest`). Ctrl+K Ctrl+P
  занят пикером открытых редакторов, Ctrl+K Ctrl+I на legacy недостижим. Стрелки
  и Escape перехватываются, только пока попап показан, и уступают suggest
  (`!suggestWidgetVisible` в `when`).
- **Класс-ловушка.** Конвертер стокового `vscode-languageclient` конструирует
  `new SignatureHelp()` (без аргументов), `SignatureInformation`,
  `ParameterInformation` и читает `SignatureHelpTriggerKind.*` на каждом запросе —
  без них в `vscodeTypes` конвертация падает целиком, а след уходит только в
  `client.outputChannel` (та же ловушка, что у `CompletionList`).

Чего нет: markdown в описаниях (плоский текст, общий `stripMarkdown` с hover),
скролла длинного описания (высота клампится), мышиного триггера и кликов по
стрелкам перегрузок.
