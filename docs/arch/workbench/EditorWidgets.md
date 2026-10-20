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
  активным редактором).

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
