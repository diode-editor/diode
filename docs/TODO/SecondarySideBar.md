# Вторичная боковая панель (Secondary Side Bar)

Аналог auxiliary bar эталона: правая колонка во всю высоту, куда переносятся
виды и контейнеры видов из сайдбара и нижней панели. Зачем сейчас — сценарий
из [ClaudeCode.md](ClaudeCode.md#раскладка): держать терминал с `claude`
справа, с живым шеллом (фокус, ввод, ресайз, переживание перезапуска).
Терминал вкладкой редактора — отдельный пункт, здесь не делается.

Устройство — [arch/Workbench.md](../arch/Workbench.md) («Вторичная боковая
панель»), ключи состояния — [arch/State.md](../arch/State.md).

## Решения человека (2026-10-18, по дефолтам плана)

- Переносы видов и видимость — `workspace` scope, как остальная раскладка (у
  эталона `views.customizations` и размер — PROFILE; отступление).
- Ширина по умолчанию — как у сайдбара (30), но не шире четверти окна
  (эталонное `min(300, w/4)`).
- `workbench.secondarySideBar.defaultVisibility` — дословно; пустая часть на
  старте не показывается; `maximized*` до развёртывания значат «видима».
- Подсказка пустой части — отступление: вместо «Drag a view here to display.»
  (перетаскивания нет) — ссылка на `View: Move View` (с PR2, где команда есть).
- `workbench.sideBar.location`, `secondarySideBar.showLabels`/`forceMaximized` —
  не поддержаны, ниже открытыми пунктами.
- «Move To» для контейнеров сайдбара (у нас нет activity bar) — в «⋯» заголовка
  контейнера; отступление.

## Стек PR

- [x] PR0 — `WorkbenchLayoutElement` переезжает из `@tuidom/elements` к нам (#649).
- [x] PR1 — часть: правая колонка и саш, `AuxiliaryBarService`/`Component`,
  команды toggle/close/focus/previous/next, `increaseViewSize`/
  `decreaseViewSize`, ключи `auxiliaryBarVisible`/`auxiliaryBarFocus`/
  `activeAuxiliary`, состояние, настройка `defaultVisibility`, сценарий
  `auxiliary-bar` (#654).
- [x] PR2 — модель расположения: аналог `IViewDescriptorService`
  (`moveViewToLocation`, `moveViewsToContainer`, `moveViewContainerToLocation`,
  сгенерированные контейнеры, `canMoveView`/`rejectAddedViews`, `reset`),
  персист `views.customizations`, ключ `focusedView`, команды `moveView`,
  `moveFocusedView`, `resetViewLocations`, `resetFocusedViewLocation`,
  `movePanelToSecondarySideBar`/`moveSecondarySideBarToPanel`, «Move To» и
  «Reset Location» в контекстном меню вкладки и в «⋯» вьюлета, сценарий
  `view-locations` (#660).
- [x] PR3 — живые виды на новом месте: Terminal/Output/Problems открываются там,
  где стоит их вид (`ViewsService.openView`/`closeView`/`isViewShown`, события
  `onDidActivateView`/`onDidShowView` вместо `PanelService`), спавн шелла по
  активации вида в любой части; приёмка — TERMINAL во вторичной панели с
  живым шеллом, ресайзом и перезапуском (сценарий `auxiliary-bar-terminal`) (#661).
- [x] Снос `workbenchlayout/` из `@tuidom/elements` — tuidom #45, релиз 0.12.0;
  diode на нём.

## Открыто после стека

- [ ] `workbench.sideBar.location` (`left`/`right`) — вторичная панель с
  противоположной стороны.
- [ ] Развёртывание вторичной панели (`maximize`/`restore`/`toggleMaximized`,
  `auxiliaryBarMaximized`, Ctrl+W на restore) и значения `maximized*`.
- [ ] `workbench.secondarySideBar.showLabels` — у нас вкладки всегда подписями.
- [ ] Перетаскивание видов мышью (`CompositeDragAndDropObserver` эталона).
- [ ] Ранжирование палитры: точное «View: Move View» стоит ниже «View: Move
  Editor…» (fuzzy-оценка, смежно с пунктом палитры в
  [ParityBacklog](ParityBacklog.md)); сценарий `view-locations` поэтому зовёт
  команду пользовательским биндом.
- [ ] Разделители в выборе из списка (`QuickPickItemKind.Separator`): сейчас
  подпись группы стоит справа у каждого пункта.
- [ ] Стартовый размер PTY — 80×24 до первого ресайза (`INITIAL_COLS`): в
  узкой вторичной панели readline перерисовывает перенесённое приглашение, и
  оно видно дважды. Эталон создаёт процесс по размеру вида — нужен размер тела
  вида TERMINAL до спавна (проблема старая, в узкой панели она тоже есть).
- [ ] Шелл после перезапуска — по активации (как в нижней панели); у эталона
  терминалы переживают перезапуск (persistent sessions).
- [ ] Legacy-алиасы эталона `workbench.action.movePanelToSidePanel` /
  `moveSidePanelToPanel` (у эталона скрыты из палитры) — не заведены.
