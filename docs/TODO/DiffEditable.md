# Editable live diff — дифф «без компромиссов» на двух настоящих редакторах

Цель: дифф-вкладка как в VS Code — **композиция двух настоящих редакторов**, где
стороны редактируются прямо в диффе (untitled/файлы), живой пересчёт по правкам,
undo/find бесплатно от редактора. Заменяет текущую рисованную read-only смотрелку
(`DiffViewElement` с синтетическими документами-снимками).

Триггер: пользователь захотел «File: Compare New Untitled Text Files» (VS Code:
дифф двух пустых редактируемых untitled). На снимочной смотрелке команда
бессмысленна; «дешёвая живость» (пересчёт read-only снимка по debounce) стала бы
выброшенной работой — идём сразу к полноценному диффу.

Связанные документы: [DiffViewer.md](DiffViewer.md) (спека сценариев US-1…US-36 —
остаётся приёмочным чек-листом; его фазы 2/5/6 поглощаются этим планом),
[Diff.md](Diff.md) (история этапов 1–6), [EditorGroups.md](EditorGroups.md)
(сплиты #245 — фундамент: несколько вью одного документа уже работают).

## Сопоставление с upstream

Исходники: `/workspaces/vscode` (main, fc78dbee; `src/` не вычекан — читать
`git -C /workspaces/vscode show HEAD:<путь>`).

- **Команда** `CompareNewUntitledTextFilesAction`
  (`src/vs/workbench/contrib/files/browser/fileActions.ts:792-819`):
  `editorService.openEditor({original: {resource: undefined}, modified:
  {resource: undefined}, options: {pinned: true}})` — обе стороны редактируются
  прямо в дифф-вкладке.
- **Живой пересчёт** (`src/vs/editor/browser/widget/diffEditor/diffEditorViewModel.ts:87-262`):
  подписка на `onDidChangeContent` ОБЕИХ моделей; debounce 200мс
  (`RunOnceScheduler`); между дебаунсами прежний дифф мгновенно патчится
  эвристикой (`applyOriginalEdits`/`applyModifiedEdits`).
- **Выравнивание сторон** — view zones (виртуальные пустые строки в каждом
  редакторе); свёртка неизменённого — hidden areas; подсветка — декорации.
- Редакторы живут между пересчётами — позиция каретки/скролла сохраняется сама.

Осознанные расхождения: инкрементальный патчинг между дебаунсами не берём (наш
полный пересчёт синхронный с капом `MAX_DIFF_COMPUTATION_MS`, объёмы терминальные);
остальное — по образцу.

## Что не хватает нашему стеку (инвентарь)

1. **View zones** в `EditorViewState`/`EditorElement` — «вставные виртуальные
   строки» (филлеры). Есть обратная операция — фолдинг (скрытие,
   `logicalToVisualLine`) — зоны встраиваются в ту же индирекцию view↔doc.
   Затрагивает маппинги, hit-test, каретку (зоны проскакиваются), рендер.
   Самый глубокий кусок, сопоставим с фолдингом.
2. **Внешние декорации** в `EditorElement`: фоновые декорации строк
   (removed/insertedLineBackground) и диапазонов (intra-line) от внешнего
   владельца. Прецеденты: подсветка поиска, markers,
   `setGutterChangeDecorations` — обобщить.
3. **Read-only `TextFileModel` по произвольной схеме**: git-сторона должна быть
   настоящей моделью поверх `git:`-провайдера. `TextFileModelRegistry` сейчас
   умеет только `file:` (follow-up уже отмечен в EditorGroups.md).
4. **DiffEditorPane v2**: контейнер из двух `EditorComponent`, скролл-синк по
   маппингу (с зонами — 1:1 в view-координатах), маркеры `-`/`+` в гуттерах,
   свёртка unchanged через СУЩЕСТВУЮЩИЙ фолдинг, живой пересчёт.
5. Бесплатное после (1)–(4): undo в сторонах, Ctrl+F в диффе (FindService
   типизирован `TextEditorPane` — стороны ими и будут), untitled-команда
   «как в VS Code», revert-чанков стрелочками.

## Что переживёт переезд

Движок диффа (вендор), `DiffViewModel`/`buildSideBySideRows` (станет расчётом
зон), `DiffInnerRanges`, цвета diffColors, всё семейство команд сравнения и ядро
`openDiffPair` (меняется только «чем» открывать), sharedDocument-механика #245.
Уйдёт: `DiffViewElement` + синтетические документы (`diffViewText.ts`,
`sideBySideRows`-текстовая часть) — ушли в PR-5.

## Фазировка (порядок выбран так, чтобы слепым был ровно один PR)

- [x] **PR-1. Вкладка-снимок + «Git: Open File at Revision...»** — сделано.
  Решение (по разведке): НЕ учить `TextFileModel` читать через реестр (это
  сломало бы синхронность `openUri`/фабрики реестра и потащило DI в модель), а
  склеить два готовых паттерна — команда читает контент через
  `IFileSystemProviderRegistry` асинхронно (как `openDiffPair.resolveSideText`)
  и открывает **вкладку-снимок**: `EditorService.openTextSnapshot(uri, {text,
  languageId, label})` — синтетическая модель (`openSynthetic` +
  `replaceOwnedContent`, как Output), `readOnly`, `labelOverride`
  (`a.ts (ref)`), дедуп по uri в группе с обновлением контента. Попутно закрыта
  дыра: `TextFileModel.openFile` получил гейт схемы (не-file uri раньше молча
  читал рабочее дерево по `fsPath` и вешал watcher на чужой путь). Осознанные
  люфты: модель мимо реестра (нет общей модели между группами), в персист
  сессии снимок не попадает, сдвиг ветки вкладку не освежает (повторный вызов
  команды — освежает).
- [x] **PR-2. View zones** — сделано (единственный инфраструктурный PR; в
  приложении зоны пока никто не включает — видимая валидация в PR-3).
  Дизайн: `IViewZone {afterLine, size}` (якорь документный, `-1` — перед первой
  строкой); зоны сидят ПОСЛЕ фолдинга в той же проекции `buildVisibleLines` —
  кодируются в массиве вью отрицательными числами с якорем (без аллокаций
  на строку); `setViewZones` нормализует (кламп, слияние якорей, no-op без
  события); `viewLineKind`/`docLineForViewLine` — дискриминатор и hit-test
  (клик по зоне падает на ближайшую документную строку); каретка непроходима
  через зоны by construction (позиции всегда документные,
  `previous/nextVisibleLine` перешагивают); PageUp/Down переведены на шаг по
  СТРОКАМ ВЬЮ (зоны съедают страницу, как пиксели в VS Code); якоря переживают
  правки (`adjustViewZonesForLineChange` в общем ядре сдвига с фолдами), гейт
  скролла при чужих правках учитывает зоны; зона на скрытом фолдом якоре
  выживает после заголовка региона (аналог upstream `showInHiddenAreas` —
  дифф сворачивает unchanged и не должен терять выравнивание). Рендер: пустой
  гуттер + пустой контент, номера строк не тратятся; indent-guides и прогрев
  токенов зон не боятся; `inspectState.viewZones` для e2e.
- [x] **PR-3. DiffEditorPane v2 — side-by-side из двух настоящих редакторов**
  (пока снимок) — сделано. Стороны — пары `TextFileModel`-снимок +
  `EditorComponent`, обёрнутые в `TextEditorPane` (`detached`); контейнер —
  свой `DiffPaneElement` (50/50 + колонка-разделитель). Раскладку считает
  чистый `computeDiffV2Layout` (зоны-филлеры из разницы длин блоков,
  фолд-регионы со сдвигом заголовка на −1, line/range/gutter-декорации,
  плашки «⋯ N unchanged lines» зонами) — гейт-инвариант «у сторон одинаковое
  число строк вью» проверяется на настоящих EditorViewState. Внешние
  декорации в `EditorElement` (`IExternalDecorations`, цвета — токены темы,
  колонка гуттер-маркеров появляется только при маркерах), у компонента —
  `setDecorations` + `foldingOwnedExternally` (авто-фолды перетёрли бы наши
  регионы и разъезжали скролл через ensurePrimaryCursorVisible). Скролл — 
  зеркалирование обеих осей с реэнтрант-гардом; одна полоса прокрутки
  (левая скрыта). Разворот свёртки — парный: подписка ловит toggleFold любой
  стороны и применяет к обеим + пересчитывает плашки.
  **`EditorService.getActiveEditor()` на v2-вкладке отдаёт активную сторону**
  (по фокусу) — команды курсора/фолдинга и статус-бар (Ln, Col) живут, ничего
  не онемело. Вход временный: `vexx.diff.compareWithHeadV2` («…with HEAD
  (v2)»), идентичность вкладки — query-суффикс `&v2`, старая смотрелка жива
  рядом; миграция — PR-4. Урок: `replaceOwnedContent` пересоздаёт view-state
  компонента (reload "owned") — раскладка перезаливается строго после
  контента обеих сторон.
- [x] **PR-4. Живость + миграция + Compare New Untitled Text Files** — сделано.
  Дизайн:
  - **Стороны-источники** (`DiffV2SideSource`): `"shared"` — общая модель файла
    из реестра `EditorService` (тот же документ, что у вкладок: правки видны в
    обе стороны, undo общий, «буфер побеждает диск» — по построению);
    `"owned"` — модель, которой панель владеет (untitled-пара); `"snapshot"` —
    синтетический read-only снимок (git-ревизия, clipboard, `preferDisk`).
    Read-only по стороне: замок на табе — только когда заперты обе.
  - **Живой пересчёт**: подписки на `onDidChangeContent` обеих МОДЕЛЕЙ
    (переживают Save As), debounce 200; `onDidReloadDocument` (revert, замена
    снимка) перевешивает скролл-синк на пересозданный view-state и
    пересчитывает сразу. Свёрнутость кусков переносится по максимальному
    пересечению диапазонов со старыми парами (новые куски свёрнуты); кусок,
    накрывший каретку любой стороны, разворачивается (`setFoldingRegions`
    каретку не переносит); скролл якорится по документной строке верха
    вьюпорта (проекция doc↔view меняется вместе с зонами).
  - **Миграция**: `openDiffPair` открывает `DiffEditorPane2`; дедуп пары — по
    ВСЕМ группам с `focusGroup(id, {focus:false})`; повторный вызов освежает
    только snapshot-стороны (`replaceSnapshotContent`, no-op на равном тексте —
    каретка не сбрасывается). Старая `DiffEditorPane` удалена (v2 — единственная
    дифф-вкладка); `DiffViewElement` жив до PR-5 (свои юниты).
    Временный вход `vexx.diff.compareWithHeadV2` удалён. `vscode.diff` понимает
    4-й аргумент `ViewColumn | {viewColumn}` (AS-20). Пикер «With...» — вкладки
    всех групп. `getActiveTabEditor()` на v2-вкладке отдаёт активную сторону:
    Ctrl+S/Save As/editor-options работают по ней.
  - **Dirty-контракт**: `isModified` вкладки = любая сторона dirty;
    `EditorService.needsCloseConfirm(pane)` — единая формула (крестик, Ctrl+W,
    адаптеры, closeEditorsInGroup): диалог — только если dirty-сторону больше
    нигде не видно (`dirtyExclusiveDiffSides`/`holdersOf` считают вкладки И
    стороны диффов); `collectDirty` (shutdown) включает dirty-стороны;
    Save в confirm-диалоге, не сумевший записать (`"no-file"` у untitled),
    оставляет вкладку открытой (заодно закрыта старая дыра untitled-вкладок).
  - **Quick diff отвязан от сторон**: биндинг `QuickDiffEditorSource` фильтрует
    detached-панели — бары не рисуются в гуттере стороны диффа.
  - «The files are identical» (US-11) — зона-нотис перед первой строкой при
    пустом диффе (`IDENTICAL_NOTICE` в `computeDiffV2Layout`).
- [x] **PR-5. Хвосты** — сделано. Решения:
  - **Ctrl+F** заработал в PR-4 «из коробки»: цель find — `getActiveEditor()`
    (активная сторона), гейт `textInputFocus` истинен на стороне. В PR-5 —
    тесты: поиск по стороне; reveal совпадения в свёрнутом куске разворачивает
    ПАРУ (через штатный фолд-синк), выравнивание держится. Осознанный люфт:
    поиск идёт по активной стороне (в VS Code — два независимых виджета), и
    матчи, как везде у нашего find, статичны до следующего пересчёта.
  - **Revert-чанка** — командой «Diff: Revert Hunk» (`vexx.diff.revertHunk`,
    только палитра — без кейбинда контекст-ключ диффа не нужен, `instanceof`
    в run): ганк под кареткой ЛЮБОЙ стороны (у пустого на этой стороне
    диапазона якорь — строка перед изменением, как у зоны-филлера), строки
    modified заменяются строками original через `applyExternalEdits` —
    undoable, живой пересчёт сам убирает разметку. Гейт: снимочная modified —
    нотис. **Кликабельные стрелки на ганках — follow-up** (нужен hit-test
    колонки маркеров в `EditorElement`).
  - **Подписи колонок** (US-14) — строка заголовков в `DiffPaneElement`
    (`HEAD │ a.ts`, цвет `editorLineNumber.foreground`, обрезка по колонке);
    дети сдвинуты на `HEADER_ROWS = 1`.
  - **US-31** — `DiffSnapshotRefreshContribution` (фаза restored): слушает
    `FileSystemProviderRegistry.onDidChangeFile` (git-расширение фаерит по
    читанным ресурсам), debounce 200, матчит изменённые uri с
    `originalUri`/`modifiedUri` снимочных сторон открытых дифф-вкладок и зовёт
    `refreshDiffSnapshots` (спеки сторон — в WeakMap у `openDiffPair`, политика
    чтения в одном месте). Диск (`file:`) событий не даёт — сторона «(on disk)»
    так не освежается (осознанно; освежает повторный вызов).
  - **Удалены** `DiffViewElement` (+5 тестовых), `diffViewText`,
    `sideBySideRows`; общий словарь (`DiffSide`, `collapsedRowLabel`, `ELLIPSIS`)
    переехал в `editor/common/diff/diffSide.ts`. `isTextViewElement` схлопнулся
    до `instanceof EditorElement`; ключи `textViewFocus`/`textInputFocus`
    совпали по значению и оставлены ради семантики when-клауз.
    `DiffViewModel.rows` остался (покрыт своими юнитами) — чистка отдельно.
- [x] **PR-6. Inline-режим v2 (узкий терминал)** — сделано. Дизайн:
  - **Зоны-призраки** (upstream inline view): в inline виден ОДИН редактор —
    modified на всю ширину; удалённые строки original рендерятся зонами с их
    текстом на фоне removed (`IViewZoneDecoration.lines: IViewZoneLine[]` —
    пер-строчные `text`/`colorToken`/`bgToken`; `lines[offset]` адресует
    `EditorViewState.zoneRowForViewLine(viewLine): {anchor, offset}` — O(1)
    через кэш стартовых строк зон рядом с кэшем проекции). Плашка свёртки и
    призрак соседнего ганка могут делить якорь (`setViewZones` сливает такие
    зоны) — `mergeZoneDecorationsByAnchor` склеивает содержимое на выходе
    панели, плашка встаёт над призраком.
  - **Раскладка** — `computeInlineLayout` рядом с `computeDiffV2Layout`: фоны
    added/intra-line/маркеры `+` как у modified-стороны, свёртка unchanged по
    modified-координатам, филлеров нет (выравнивать нечего). У original в
    inline — пустая раскладка (возврат в side-by-side не встречает старых зон).
  - **Переключение** — `DiffPaneElement`: режим = чистая функция ширины
    ЭЛЕМЕНТА (порог `SIDE_BY_SIDE_MIN_COLS = 100`, гистерезис выхода +4 —
    дрожание сайдбара не переклеивает) и `modeOverride`; о смене сообщает
    колбэком из layout, панель перекладывает зоны ОТЛОЖЕННО (микрозадача —
    правка зон из layout напоролась бы на dirty-гейт TuiApplication).
    Original скрывается `hidden` (фокус hidden не двигает — панель переносит
    его в modified явно, но не крадёт, если фокус уже вне original).
    `activeSide` в inline — всегда modified; revert-чанка работает как есть.
  - **US-22** — «Diff: Toggle Inline View» (`vexx.diff.toggleInlineView`):
    inline ↔ side-by-side, применяется ко всем открытым дифф-вкладкам, выбор
    персистится (`DIFF_VIEW_MODE_STATE`, workspace-scope; `auto` — дефолт до
    первого тумблера, вернуть его можно только сбросом стейта — осознанный
    люфт). Каретка при переключении сохраняется сама: modified-редактор живёт.
  - Люфт: у призраков нет original-номеров строк в гуттере (VS Code их
    показывает отдельной колонкой) — гуттер зоны пуст; добавится, если
    попросится.

## Известные грабли (из разведки, чтобы не переоткрывать)

- `getPanes()` после #245 — только активная группа; все вкладки — `getEditors()`
  (текстовые всех групп); дедуп по uri — пер-группный. В текущем `openDiffPair`/
  `compareActions`/`compareWithHeadAction` есть `getPanes()`-места, которые при
  сплитах ведут себя неточно — чинить при миграции на v2 (PR-4).
- `newUntitled()` возвращает void, открывает в активную группу; панель забирать
  через `getActiveTabEditor()` сразу после вызова.
- `openPane` кладёт только в активную группу; таргетинг группы — через
  `focusGroup(id, {focus:false})` (образец `editorLayoutServiceAdapter.ts:86-91`).
- Сплит дифф-вкладки даёт пустую группу (гейт `file:` в `splitActiveGroup`) —
  для v2 решить, делится ли она дублем.
- Untitled после Save As меняет uri (`handleUriChanged`) — подписки живости
  обязаны переживать смену uri стороны.
- AS-20 из EditorGroups.md: `vscode.diff` с `{viewColumn}` четвёртым аргументом —
  закрыть в PR-4.
