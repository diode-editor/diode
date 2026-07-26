# TUIDom/

Часть архитектуры Vexx — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

TUI-фреймворк — дерево элементов с layout, событиями, фокусом (аналог браузерного DOM). Layout и позиционирование — в [../LAYOUT.md](../LAYOUT.md).

`RenderContext` инкапсулирует то, что виджеты не обязаны знать: рендеринг wide chars (`drawText` через `DisplayLine` — без ручной возни с grapheme-слотами) и рамки (`drawBox` — углы/линии одним вызовом, `fill`, `separators`, пресеты из `BorderStyle.ts`, канон — `BORDER_ROUNDED`). Все бордер-виджеты рисуют рамку через него — единый стиль, без дублированных циклов.

Подсистемы: **Events** (capture/bubble, клавиатура/фокус, менеджер фокуса с tab-навигацией, default actions), **Styles** (наследование `fg`/`bg` от родителя, sentinel `INHERITED_*`, dirty-пропагация + top-down резолвинг; компонент-специфичные стили через generic `TUIElement<S extends TUIStyle>`), **Widgets** (боксы с рамкой, стек, word-wrap текст, скролл, меню, `CompletionListElement`, `FitContentElement` — контейнер «размер по содержимому» под loose-constraints overlay-слоя, типовой корень диалогов/поповеров, `SizedBoxElement` — контейнер фиксированного «предпочтительного» размера (клампится к constraints), корень overlay-виджетов фиксированной ширины (find), и др.).

Диалоги приложения (`ConfirmDialog`/`ConfirmSaveDialog`/`AboutDialog`) — **не** виджеты TUIDom: они живут компонентами в `Workbench/Components/Dialogs/` (владеют `FitContentElement` и собирают в нём дерево примитивов), см. [Workbench.md](Workbench.md).

## OverlayLayer + pointerPolicy (инвариант)
`OverlayLayer` — overlay-менеджер с session API (`createSession`/`openPopupSession`): единый lifecycle popup/dialog/quick-open, политики закрытия, restore-focus, якорное позиционирование с clamp/flip по экрану.

**`pointerPolicy` — обязательное поле сессии** (пропуск = ошибка компиляции, дефолта нет). Закручивает инвариант «окно либо закрывается по клику снаружи, либо не пропускает клики позади себя». Три варианта:
- `"close-on-outside"` — клик мимо закрывает сессию, но доходит до элемента позади (контекст-меню, Quick Open).
- `"modal"` — клик мимо **блокируется** (`elementFromPoint` отдаёт сам модал), Tab-фокус заперт focus-scope'ом в `FocusManager`. Диалог несохранённых изменений.
- `"passthrough"` — клик проходит насквозь, сессия не закрывается через OverlayLayer (Find, дропдаун меню-бара).

## Default Actions (модель Web DOM)
У каждого элемента есть встроенное поведение (`performDefaultAction`), отделённое от клиентских listeners. Порядок обработки: capture → target → bubble → **default action на target-элементе**. Правила, которые нельзя вывести из кода за секунду:
- `preventDefault()` (на любой фазе) **отменяет** default action; `stopPropagation()` — **не** отменяет.
- `performDefaultAction` вызывается **только на `event.target`**, не на всей цепочке propagation.
- Default action — то, что клиент может захотеть отменить (открытие подменю, навигация клавишами). НЕ default action — internal state (сохранение `previousFocusedElement`, деактивация при blur).

**Готча «click → callback»:** когда target события — внутренний дочерний элемент (hit-test попал в `TextLabelElement` внутри `MenuBarItemElement`), полагаться на `performDefaultAction` родителя нельзя — используй bubble-listener с проверкой `defaultPrevented`.

## ListViewElement (`ui/list/`) — виртуализирующий список

Контейнер для «много строк»: потребитель императивно собирает **обычные TUIElement-строки** (высота ровно 1) и добавляет их через `appendRow(element, { parentId?, label? })`; никаких renderer-делегатов и JSX. Виртуализация спрятана внутри: `performLayout`/`render` трогают только строки видимого окна `[scrollTop, scrollTop+height)`, хит-тест — арифметика, поэтому стоимость кадра не зависит от числа строк (бенч: ~1 мс на 100k строк). У каждой строки обязан быть непустой `element.id` — иначе `appendRow` бросает.

Что контейнер даёт бесплатно (общие механики списков, 1:1 с `TreeViewElement`): фокус (`tabIndex=0`, строки в Tab-обход не попадают), курсор + мультивыбор (Shift/Ctrl), клавиатура (стрелки, Enter→`onActivate`, Space→collapse, PageUp/Down/Home/End — и внутри для standalone-использования, и через глобальные `list.*`-команды workbench, чей ключ `listFocus` покрывает оба списочных контрола), hover, typeahead по `label` (выключается опцией конструктора `typeahead: false` — так делает поиск, где буквы принадлежат строке запроса), сигнал `onContextMenu(element, screenX, screenY)`. Иерархия — через `parentId`: строка с детьми получает шеврон (гуттер «auto»: без сворачиваемых строк отступ не резервируется), `setCollapsed`/`toggleCollapsed` прячут поддиапазон; `setRowHidden` — то же для произвольной строки. `getChildren()` отдаёт **всех** (root-пропагация и стили должны доходить до каждого — канон `OverlayLayer`), culling — точечно в layout/render/хит-тесте/фокус-обходе.

Выделение/hover рисуются **post-render оверлеем**: контейнер читает готовые ячейки строки через `RenderContext.getCell` и патчит только те, чьи fg/bg совпадают с унаследованными, — собственные цвета строки (подсветка совпадения, приглушённый номер) выделение переживают, а стили детей никогда не мутируются из render-пути. Граница ответственности контекстного меню: контейнер только **сигналит** координатами, сборка пунктов из `MenuRegistry` и подъём `OverlayLayer`-сессии — уровень Workbench.

Строки презентационные (хит-тест возвращает контейнер), с одним исключением — **делегацией кликов**: левый click/dblclick без модификаторов контейнер ре-диспатчит в поддерево строки, и если чей-то listener вызвал `preventDefault()`, событие считается потреблённым — курсор/выделение/активация не трогаются. Так строка несёт инлайн-кнопки (обычные элементы с click-listener'ом), ничего не зная о списке. Делегация доверяет только окну, разложенному последним `performLayout` (скролл или пересборка проекции между кадрами её выключают до следующего кадра — иначе незалейаученные строки с ленивыми позициями ловили бы чужие клики).

Первый потребитель — результаты поиска (`workbench/contrib/search/`): строки — одиночные `TextLabelElement` с посимвольной подсветкой (`setCharStyle`), режимы дерево/плоско отличаются только наличием `parentId` при append. Инлайн-кнопки на делегации использует Source Control (`workbench/contrib/scm/`): строка = `HFlexElement` из имени (fill), глифа Open File и буквы статуса. Стресс-сторисы и бенчи — рядом с виджетом (`listViewElement.stories.ts`, `listViewElement.bench.ts`).

## Terminal-виджет (`Widgets/Terminal/`)
`TerminalViewElement` — лист-виджет встроенного терминала: каждый кадр читает абстрактную сетку ячеек через `ITerminalSurface` (`readCell`/`getCursor`) и блитит её в grid. Виджет **чистый** — он ничего не знает про PTY и VT-эмулятор: реальная связка (node-pty + `@xterm/headless`) реализует `ITerminalSurface` уровнем выше, в Workbench (`EmbeddedTerminalSession`), поэтому под `src/vs/base/browser/` не протекают импорты `@xterm/headless`/`node-pty`, а виджет тестируется скриптованным `FakeTerminalSurface`. Размером PTY управляет `performLayout` (реально выделенная область → `surface.resize`, TIOCSWINSZ+SIGWINCH), ввод пробрасывает в поверхность через чистую функцию `encodeKeyForPty` (клавиша → байты, которые ждёт PTY), мышь — через `sendMouse`. Прокрутка вьюпорта по скролбэку живёт в поверхности (`scrollOffset`/`scrollLines`, `readCell` сама читает строку со смещением, курсор в истории прячется): колесо и Shift+PageUp/PageDown виджет обрабатывает **локально**, пока `surface.mouseEventsActive` не сообщит, что программа в шелле включила свой mouse-tracking — тогда колесо целиком её. Цвета «по умолчанию» (`defaultFg`/`defaultBg`) пушит владелец-компонент из активной темы. `TUIElement` не имеет lifecycle-хука, поэтому подписки на поверхность виджет держит сам и рвёт в `dispose()` (владелец — `TerminalPanelComponent` — обязан его вызвать). Оркестрация и упаковка → [Workbench.md](Workbench.md), [../TODO/IntegratedTerminal.md](../TODO/IntegratedTerminal.md).
