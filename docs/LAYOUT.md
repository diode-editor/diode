# Layout и позиционирование

## Ментальная модель

Элемент не живёт сам по себе — его помещают в контейнер. Контейнер решает, где ребёнок стоит и сколько места ему выделить. Ребёнок рисует себя в **локальных координатах** (от 0,0), а `RenderContext` автоматически транслирует их в экранные координаты и обрезает по `clipRect`.

Простые виджеты рисуют весь свой контент — clipRect гарантирует, что за пределы выделенной области ничего не попадёт. Тяжёлые виджеты (EditorElement) могут оптимизировать рендер, рисуя только видимую часть.

## Размер элемента (`allocatedSize`)

`allocatedSize` — это **выделенная видимая область** элемента на экране, а не размер его контента. Контейнер-родитель определяет это значение через вызов `performLayout(constraints)`. Элемент рисует себя от (0, 0) в локальных координатах, а clipRect обрезает всё, что выходит за границы.

Публичный геттер `layoutSize` — ленивый: если `isLayoutDirty`, он вызывает `performLayout` с loose constraints. Это fallback для чтения размера вне цикла layout.

## Владение деревом: appendChild-семейство и hidden

Список детей принадлежит базовому `TUIElement`; топология меняется **только** через
`appendChild` / `insertChild` / `removeChild` / `replaceChild` / `setChildren`
(protected — снаружи контейнер даёт свой доменный API: `setContent`, `addView`, `appendRow`).
Эти методы атомарно держат обратную ссылку `getParent()`, поэтому «ребёнок в списке без
родителя» непредставим. `getChildren()` не переопределяется. Порядок детей — это
одновременно z-порядок хит-теста (последний — поверх) и порядок Tab-обхода; слотовые
контейнеры пересобирают канонический порядок декларативным `setChildren` (см.
`BodyElement.syncChildren`).

Видимость отделена от структуры флагом **`hidden`** (аналог `display:none`): скрытый
элемент остаётся в дереве — `getRoot()` и каскад стилей до него доходят, — но выпадает из
Tab-обхода и hit-теста (базовые обходы), а контейнер его не раскладывает и не рисует
(`renderChildren` пропускает). Так живут неактивные вкладки `PanelContainerElement`,
скрытые панели/сашы `WorkbenchLayoutElement` и закрытые сессии `OverlayLayer`. Куда уходит
фокус при скрытии — политика уровня workbench (`PanelFocusContribution`), не базы.

Производные величины (кэшей нет, протухнуть нечему):
- **`getRoot()`** — прогулка вверх по цепочке родителей до вершины с меткой `setAsRoot()`;
- **`globalPosition`** — `parent.globalPosition + localPosition` (у отсоединённого — равен
  `localPosition`).

Инварианты дерева проверяет `validateTree` (`tuidom/dom/validateTree.ts`): в тестах — после
каждого кадра (`TestApp`), в приложении — `VEXX_VALIDATE_TREE=1`.

## Контейнеры и `performLayout`

Layout управляют контейнеры. Каждый контейнер (`VStackElement`, `BodyElement`, `ScrollBarDecorator`, `OverlayLayer`) в своём `performLayout()`:

1. Вызывает `super.performLayout(constraints)` — фиксирует собственный размер
2. Для каждого видимого ребёнка вычисляет позицию и размер по своей логике и вызывает
   `this.layoutChild(child, x, y, childConstraints)` — хелпер ставит `localPosition` и
   прогоняет layout ребёнка (`globalPosition` производный, его никто не выставляет)

Листовые элементы (`BoxElement`, `EditorElement`, `PopupMenuElement`) используют базовый `performLayout`, который просто применяет `constraints.constrain()` к текущему размеру. Некоторые (`PopupMenuElement`) переопределяют метод для вычисления intrinsic size.

## `layoutStyle` и `layoutState`

Поля `layoutStyle` и `layoutState` — нетипизированные (`unknown`) слоты для коммуникации между элементом и его контейнером-родителем:

- **`layoutStyle`** — задаётся извне при добавлении ребёнка в контейнер. Описывает желаемое позиционирование внутри конкретного контейнера. Например, `VStackLayoutStyle` содержит `{ width: number | "fill", height: number }`. Контейнер читает это поле в своём `performLayout()`.
- **`layoutState`** — записывает контейнер в `performLayout()` для хранения вычисленных промежуточных данных (например, `{ rect: Rect }`).

Оба поля специфичны для типа контейнера. Элемент не знает, в каком контейнере он находится — он просто хранит эти значения.

## Координатная система

- **`localPosition: Offset`** — смещение элемента относительно родителя. Устанавливает контейнер в `performLayout()` (через `layoutChild`). Это ЕДИНСТВЕННАЯ хранимая координата.
- **`globalPosition: Point`** — абсолютная позиция на экране (0-based), **производный геттер**: `parent.globalPosition + localPosition`; у элемента без родителя равен `localPosition`. Раньше это было второе поле, которое контейнеры выставляли руками параллельно, — забытая запись давала элемент, который рисуется, но не кликается.

Корневой элемент получает `localPosition = (0, 0)` от `TuiApplication` перед вызовом `performLayout()`.

## RenderContext

При рендере `RenderContext` несёт:

- **`offset: Offset`** — абсолютное смещение текущего элемента на canvas. Контейнеры пробрасывают его через `context.withOffset(child.localPosition)`.
- **`clipRect: Rect`** — область обрезки в экранных координатах. Контейнеры пробрасывают через `context.withClip(childVisibleRect)`, где `childVisibleRect = Rect(child.globalPosition, child.layoutSize)`. Clip rect'ы пересекаются — дети не могут рисовать за пределы родителя.

Виджеты используют `context.setCell(x, y, cell)` для рендера в локальных координатах. Метод транслирует координаты: `screenX = x + offset.dx`, `screenY = y + offset.dy`, проверяет попадание в clipRect и пишет в canvas. Аналогично работает `context.setCursorPosition(x, y)`.

`RenderContext.offset` и `globalPosition` считают одну величину двумя путями: offset накапливается при рендере, globalPosition выводится из цепочки родителей. Совпадают всегда, пока контейнер рисует детей канонично — базовым `render()`/`renderChildren()` (offset = `child.localPosition`, clip = границы ребёнка, скрытые пропускаются). Свой цикл отрисовки нужен только контейнерам с нестандартной трансляцией: `ScrollViewport` (сдвиг на `-scrollTop`), `ListViewElement` (виртуализация).

## Скролл

Скролл разделён на два компонента:

- **`ScrollViewport`** — engine скролла. Оборачивает scrollable-ребёнка (реализующего `IScrollable`), сдвигает offset на `-scrollTop` и обрезает по своим границам. Ребёнок рисует весь контент от y=0, а viewport показывает только видимую часть.
- **`ScrollBarDecorator`** — рисует скроллбар рядом с ребёнком. Не управляет скроллом — только визуализация.

Для простых виджетов (TextBlockElement) используется композиция:
```
ScrollBarDecorator → ScrollViewport → TextBlockElement
```

Для тяжёлых self-scrolling виджетов (EditorElement), которые сами оптимизируют рендер видимой области:
```
ScrollBarDecorator → EditorElement
```

`IScrollable` определяет `contentHeight` и `scrollTop`. `ScrollViewport` реализует `IScrollable`, делегируя обёрнутому ребёнку.

## Цикл layout → render

```
TuiApplication.renderFrame():
    root.localPosition = (0, 0)
    root.performLayout(tight(screenSize))          // рекурсивно: размеры + позиции
    screenClip = Rect((0,0), screenSize)
    root.render(RenderContext(screen, offset=0, screenClip))  // рекурсивно: отрисовка
    screen.flush(backend)
```

## Текущие ограничения

- **Нет z-index**: порядок отрисовки и перекрытие определяет порядок детей в контейнере (последний ребёнок — поверх). `ContextMenuLayer` — всегда последний ребёнок `BodyElement`, что гарантирует overlay-поведение.

## Intrinsic Size API

Элементы умеют отвечать на вопрос «какой размер мне нужен?» **до** вызова `performLayout()`. Это чистые read-only методы без side-effects:

- `getMinIntrinsicWidth(height)` — минимальная ширина, при которой элемент способен отрисоваться без потери контента
- `getMaxIntrinsicWidth(height)` — максимальная ширина, которую элемент может полезно использовать (больше — пустое место)
- `getMinIntrinsicHeight(width)` / `getMaxIntrinsicHeight(width)` — аналогично для высоты

Базовая реализация в `TUIElement` возвращает 0 для всех четырёх. Элементы переопределяют по необходимости.

Параметр `height`/`width` зарезервирован для виджетов с word-wrap (высота зависит от ширины). Сейчас большинство элементов его игнорируют.

Intrinsic-методы используются контейнерами (HFlexElement, будущий VFlexElement) для режима **Fit** — «подстройся под контент ребёнка».

## SizedBoxElement

Контейнер фиксированного «предпочтительного» размера с одним ребёнком: под входящими
constraints резолвит размер как `preferredWidth`/`preferredHeight`, заклампленный в
`[min, max]`, и кладёт ребёнка tight на этот размер. Неуказанная ось делегируется
max-intrinsic ребёнка (по ней ведёт себя как `FitContentElement`). Нужен для
overlay-виджетов фиксированной ширины: overlay-слой даёт loose-constraints на всю
доступную область, а виджету надо занять свой предпочтительный размер (например,
find-виджет). В отличие от `FitContentElement` (тянется по контенту) и `HFlexElement`
(по детям), задаёт размер явно.

## HFlexElement

Горизонтальный flex-контейнер. Раскладывает детей в строку. Каждому ребёнку задаётся `HFlexLayoutStyle`:

```
width: Fixed(n) | Fit | Fill     — размер по главной оси (горизонтальной)
height: number | "fill"          — размер по cross оси (вертикальной)
```

Режимы ширины:
- **Fixed(n)** — ровно n символов
- **Fit** — ширина по `getMaxIntrinsicWidth()` ребёнка
- **Fill** — заполнить оставшееся после Fixed и Fit (максимум один Fill-ребёнок)

Алгоритм `performLayout`:
1. Суммировать ширины Fixed-детей
2. Измерить Fit-детей через `getMaxIntrinsicWidth()`, суммировать
3. `remaining = containerWidth - fixedSum - fitSum`
4. Fill-ребёнок получает `remaining`
5. Вызвать `child.performLayout(tight(width, height))` для всех

Хелперы: `hflexFixed(n)`, `hflexFit()`, `hflexFill()`.

## WorkbenchLayoutElement — сайдбар, редактор и нижняя панель

`WorkbenchLayoutElement` — слева панель (explorer) на всю высоту, справа центр (редактор),
а под редактором — **нижняя Panel** (вкладки PROBLEMS и TERMINAL; далее Output/…), выровненная по ширине редактора
(align=center, как дефолт VS Code; sidebar остаётся слева на всю высоту). Ширина сайдбара и
высота панели — **абсолютные**, в колонках/строках (`leftPanelWidth`=30, `bottomPanelHeight`=12),
поэтому при ресайзе терминала они сохраняют размер, а перетекает только редактор. Нижняя
панель по умолчанию **скрыта** (`bottomPanelVisible=false`) — как в VS Code.

Изменять размеры можно:
- мышью — перетаскиванием границы (см. `SashElement` ниже): вертикальный сэш двигает сайдбар,
  горизонтальный — высоту нижней панели;
- командами палитры `workbench.action.increase/decrease/resetSidebarWidth` (сайдбар);
- видимость панели — `workbench.action.togglePanel` (Ctrl+J) / `workbench.actions.view.problems`
  (Ctrl+Shift+M) / `workbench.action.terminal.toggleTerminal` (Ctrl+` — показывает вкладку TERMINAL;
  бинд только на tier `kitty`/`csi-u`).

Клэмпы — единые, в `performLayout`: ширина через `clampWidthTo` (не меньше `MIN_LEFT_WIDTH`,
редактору остаётся ≥ `MIN_CENTER_WIDTH`), высота панели через `clampHeightTo` (не меньше
`MIN_PANEL_HEIGHT`, редактору остаётся ≥ `MIN_EDITOR_HEIGHT`). `performLayout` клэмпит **только
отображаемый** размер и не мутирует сохранённые значения — поэтому временно узкий/низкий
терминал не «съедает» абсолютный размер навсегда. Интерактивные изменения клэмпят сохранённое
значение сразу, чтобы кнопки/сэш не «залипали».

### SashElement — перетаскиваемый разделитель

`SashElement` (`tuidom/ui/sash/sashElement.ts`) — невидимый хит-таргет на границе панелей;
параметр `orientation` (`"vertical"` — колонка шириной 1, ресайз по X; `"horizontal"` — ряд
высотой 1, ресайз по Y). Оба сэша — постоянные дети layout (последними в списке, чтобы `elementFromPoint` находил их
поверх соседнего контента); каждый скрыт (`hidden`) вместе со своей панелью. Раскладываются в
`performLayout` на границе (вертикальный — на колонке `leftWidth`; горизонтальный — на строке
`centerHeight`, верхняя строка панели).

Перетаскивание опирается на **opt-in pointer capture**: `TUIElement.capturesPointer` (по
умолчанию `false`) у sash выставлен в `true`. Пока зажата кнопка, `MouseEventDispatcher`
шлёт `mousemove`/`mouseup` именно в захватчик (а не в элемент под курсором) и подавляет
enter/leave — иначе при уводе мыши за 1-колоночную границу события ушли бы в редактор, и он
поймал бы «случайный» клик. Sash сообщает наверх абсолютную координату границы (`screenX` для
вертикального, `screenY` для горизонтального), а `WorkbenchLayoutElement` переводит её в
ширину/высоту и клэмпит.
