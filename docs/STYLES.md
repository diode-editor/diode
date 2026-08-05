# Модель стиля tuidom (Н3)

Решение по [TuidomContracts.md](TODO/TuidomContracts.md) Н3 (2026-08-01):
**каскад — единственный источник цвета на отрисовке; состояния разрешает ядро;
цвета адресуются токенами-переменными**. Прецеденты: CSS (псевдоклассы +
custom properties), эволюция самого VS Code от `IStyles`-структур к
`--vscode-*`-переменным, Textual.

До Н3 сосуществовали два канала: каскад `resolvedStyle` (fg/bg) и приватные
структуры `I*Styles`, пушившиеся из 13 мостов `defaultStyles.ts` по 21 подписке
на тему, с 12 `unthemed*`-палитрами RGB-литералов в виджетах и шестью ручными
реализациями hover/focus. Всё это удалено.

## Декларация: TUIStyle

```ts
element.style = {
    fg: "menu.foreground",                 // число | сентинел INHERITED_* | имя токена
    bg: INHERITED_BG,
    when: [                                 // варианты по состояниям
        { states: ["hover"], bg: "list.hoverBackground" },
        { states: ["selected"], fg: "...", bg: "..." },
        { states: ["selected", "in:focus"], bg: "..." },
    ],
};
```

- **when-запись применяется, когда активны ВСЕ её селекторы (AND); позже
  объявленная активная запись побеждает** — порядок = приоритет, как порядок
  правил CSS. `states: []` легален («всегда активна»).
- Селектор `"x"` — состояние на самом элементе; `"in:x"` — на себе или любом
  предке (замена descendant-комбинатора; ключ к active/inactive selection:
  строка объявляет `["selected", "in:focus"]`, а focus-состояние стоит на
  списке). Осторожно: `in:hover` шире CSS-`:hover` — светится и когда курсор
  на сиблинге внутри hovered-контейнера.
- Сеттер `style` сравнивает по значению (`styleEquals`) — повторный пуш равного
  объекта (пере-применение темы, пересборка виджета) не дирявит поддерево.

## Состояния

Набор активных состояний живёт на элементе (`setStyleState`/`hasStyleState`/
`activeStyleStates`). **hover и focus ведёт ядро**: hover — диспатчер мыши по
всей цепочке target→root (как `:hover`; при pointer capture заморожен), focus —
FocusManager только на target (как `:focus`). Состояние обновляется ДО диспатча
mouseenter/mouseleave/blur/focus — слушатели видят его консистентным.
Произвольные строковые состояния ("selected", "checked", "active", "lit", …)
виджеты ставят программно; смена состояния перерезолвит стиль элемента и
поддерева.

Состояния читают и мимо каскада: `hasStyleState` — своё, `hasStyleStateWithin`
— своё или предка (рантайм-двойник `in:`). Второй нужен тем, кто решает не
цветом, а **геометрией**, и потому обязан знать состояние ещё в `performLayout`,
до стилевого прохода. Так живёт инлайн-кнопка Open File в строке Source Control:
`ListViewElement` ставит на обёртку строки `LIST_ROW_ACTIVE_STATE`
(«под указателем ИЛИ под курсором сфокусированного списка»), а корень строки по
нему отдаёт кнопке колонки — или ноль, и всё место достаётся имени файла.
Отдельное состояние здесь не прихоть: `in:hover` не подошёл бы, потому что
строки списка презентационные, target мыши — сам список, и hover стоял бы на
предке всех строк разом.

**Дети наследуют РЕЗУЛЬТАТ резолва родителя с учётом его состояний** — hover-фон
строки списка автоматически течёт в её презентационные метки, а явные
посимвольные подсветки (charStyles с конкретными цветами) выделение переживают.
Именно это убило пост-рендерные патчи ячеек в listView.

## Токены-переменные (аналог CSS custom properties)

`StyleColor = number | имя токена`. Таблицы токен→число каскадируют по дереву
(`setStyleVars`, обычно только на корне), дно цепочки — `STYLE_TOKEN_DEFAULTS`
(`tuidom/dom/styles/styleTokens.ts`) — **единственное место RGB-литералов
tuidom**. Правило: токен, на который ссылается виджет tuidom/ui, обязан иметь
дефолт там — иначе тесты/stories без хостовой таблицы упадут fail-fast'ом.

- Имена — в конвенции color id VS Code (`"list.activeSelectionBackground"`);
  tuidom-специфика без эквивалента — под своим именем (`menu.shortcutForeground`,
  `quickPick.*`, `menuBar.*`, `titledPanel.*`).
- Незнакомый токен — **throw с именем класса и токена** на первом же кадре
  (наш fail-fast; опечатки хостовых ключей компилятор не ловит — типизирован
  только автокомплит по дефолтам).
- Painter-виджеты (editor, terminal, quickpick, деревья) читают токены в render
  через `styleVar(name)`; `styleVar(name, fallback)` — для токенов, чьё
  отсутствие ЛЕГАЛЬНО означает «взять из каскада» (`editorGutter.background` →
  фон редактора). `resolveColor(color)` резолвит StyleColor из ДАННЫХ
  (посимвольные стили, `ITreeItem.iconColor` — провайдеры отдают
  `gitDecoration.*`, раскраска переживает смену темы без пере-пуша).
- Значения таблиц — только конкретные числа; сентинелы INHERITED_* в таблицах
  запрещены (assert).

## Заливка фона

База `render()` заливает прямоугольник элемента `resolvedStyle.bg`, если bg
задан СОБСТВЕННЫМ стилем (базой или сработавшим when-вариантом); без
собственного bg элемент прозрачен, как в CSS. `INHERITED_BG` — намеренная
перезаливка цветом родителя (так устроен FillerElement), `INHERITED_FG` —
инверсия. Кастомный painter зовёт `paintOwnBackground(context)` сам.

## Доставка темы (хост Vexx)

Одна точка: `applyThemeVars(root, theme)`
(`src/vs/platform/theme/browser/themeStyleVars.ts`) кладёт всю палитру
активной темы в корневой var-scope; подписан только WorkbenchComponent.
Hot-swap темы = повторный вызов, дерево перерезолвится каскадом. Компоненты
задают ИМЕНА токенов в `style` своих контролов один раз при создании и тему не
слушают — инфраструктура ThemedComponent/initStyles/updateStyles удалена.
Фоллбэки бывших мостов (`terminal.background ?? panel.background`,
`terminal.foreground ?? editor.foreground`) живут в applyThemeVars;
`editorGutter.background ?? editor.background` — fallback на месте чтения.

В тестах: TestApp кладёт палитру dark+ в корень (паритет с приложением);
standalone-рендеры tuidom-виджетов живут на дефолтах STYLE_TOKEN_DEFAULTS;
хостовым компонентам (`sideBar.*`, `statusBar.*` — без дефолтов tuidom) —
`renderElement(..., { themeVars: true })` либо явный `applyThemeVars`.

## Зафиксированные решения и известные сдвиги

- Числовой `tabIndex`-подобный порядок и z-index не появились; когда-нибудь
  понадобившийся приоритет состояний выражается порядком when-записей и
  закрывается styling-тестами (типы его не ловят).
- quickpick впервые темизируется (раньше — вечная unthemed-палитра); вид в
  не-dark темах изменился намеренно. Ключи `input.*`, `quickInput.*`,
  `menubar.selection*`, `list.highlightForeground` добавлены в реестр цветов.
- Problems-дерево унифицировано на `list.deemphasizedForeground` для
  cut/symlink (раньше — unthemed-значения).
- Hover списков включён по умолчанию (`list.hoverBackground`); hover не меняет
  fg (токен `list.hoverForeground` пока не поддержан — аддитивно позже).
- Залипание hover при detach hovered-поддерева до следующего mousemove —
  паритет с прежним поведением диспатчера; follow-up: notifyDetached.
- `TUIElement<S extends TUIStyle>` удалён: расширение стиля — when-варианты и
  токены, не наследование интерфейса.

## Метрика Н3

Файлов tuidom/ui с кастомным `render`: 25 → 22; главное — из render-кода
полностью ушли state-ветвления цветов (кнопка, вкладки, пункты меню, строки
списков) и пост-рендерные патчи: состояние → стиль разрешает ядро.
