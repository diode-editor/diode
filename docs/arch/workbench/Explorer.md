# Explorer

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).

Дерево файлов сайдбара и файловые операции.

- `contrib/files/browser/fileTreeDataProvider.ts` — данные дерева (ленивая загрузка по
  уровням, chokidar-watch раскрытых каталогов, статус-декорации/иконки,
  исключения по живой настройке `files.exclude` — см.
  [Configuration.md](../Configuration.md#слой-exclude-настроек)).
  `explorer.compactFolders` — лениво, как эталон: раскрытие узла спускается от
  головы, пока у папки единственный ребёнок-каталог (не симлинк), и
  переписывает узел строки — `path` становится последней папкой, свёрнутые
  предки — в `compactParents`, ключ дерева остаётся
  головой (раскрытие переживает рост и разрыв цепочки). Оторвавшийся при
  разрыве хвост — новая строка со своим ключом и встаёт свёрнутым; так же
  у эталона: id сжатого узла — склейка id цепочки, `preserveCollapseState`
  новый узел «b/c» не узнаёт и берёт `collapseByDefault` Explorer'а. За раскрытым
  компактным узлом следят по каждой папке цепочки: изменение в последней
  перечитывает сам узел, в промежуточной — забывает цепочку и перечитывает
  родителя головы. Сегменты строки провайдер отдаёт дереву как
  `ITreeItem.labelSegments`; текущий сегмент (по умолчанию последний,
  подчёркнут) держит `TreeViewElement` — как `CompressedNavigationController`
  эталона: Left/Right/клик двигают его, выбор живёт по ключу строки и
  переживает refresh и сворачивание строки (у эталона сбрасывается при любой
  перерисовке строки: diode делает refresh на каждое обновление
  git-декораций), сбрасывается при смене цепочки. Команды эталона
  `previous/next/first/lastCompressedFolder` (`compressedFolderActions.ts`,
  Left/Right/Home/End, вес `WorkbenchContrib + 10`) гейтятся ключами
  `explorerViewletCompressed{,First,Last}Focus` — их ставит
  `ExplorerComponent.updateContextKeys` по строке под курсором; на краю
  цепочки ключ снимает бинд, и клавиша уходит дереву (свернуть, к родителю,
  `list.focusFirst`).
- `contrib/files/browser/explorerService.ts` — логика Explorer'а (аналог `IExplorerService`):
  корень воркспейса + владение провайдером (`setRootPath` пересоздаёт провайдер и
  файрит `onDidChangeRoot`), `revealPath` (цепочка предков строится по ходу
  раскрытия — следующая строка зависит от найденной компактной цепочки;
  промежуточная папка компактной строки выделяет саму строку, текущий сегмент
  не трогает — как эталон),
  `autoRevealActiveFile` (настройка `explorer.autoReveal`; активный файл передаёт
  `WorkbenchComponent`), выбор (`getSelectedPaths`/`getPasteTargetDir`; у
  компактной строки — папка текущего сегмента, `nodePath`; в мультивыборе —
  все папки цепочки, как `getContext` эталона, а вставка схлопывает вложенные
  пути, как `distinctParents`),
  `setFileDecorations` (мост декораций extension-host'а: адаптер
  `FileDecorationsServiceAdapter` типизирован минимальным интерфейсом
  `IFileDecorationsTarget`, сервис соответствует структурно), подсветка
  «вырезанных» по `IFileClipboard.onDidChange` и лог ошибок file-watcher'а
  (`filetree.watcher`, подсказка про inotify-лимит). Дерево приходит через шов
  `IExplorerView` (refresh/reveal/focus/selection/cut-keys):
  `TreeViewElement<FileTreeNode>` соответствует структурно, регистрирует его
  компонент через `attachView`.
- `contrib/files/browser/explorerComponent.ts` — `Component`; по
  `onDidChangeRoot` строит `TreeViewElement` поверх провайдера сервиса
  (обёрнут `ScrollBarDecorator` + `TitledPanelElement` «EXPLORER»,
  `view.id = "explorer"`; стили — `getFileTreeStyles`/`getScrollBarStyles`),
  вяжет события дерева (expand → watch каталога, активация файла → команда
  `workbench.openFile`) и открывает контекст-меню дерева через
  `ContextMenuService` — делегат с `MenuId.ExplorerContext`, пункты исполняют
  команды `explorer.*`/`fileOperations.*`; правый клик и Shift+F10 — одно
  событие `contextmenu` движка, один путь. Раскрытие папки жестами по строке —
  настройка `workbench.tree.expandMode` (предикат
  `TreeViewElement.expandOnlyOnTwistieClick`, читает её на каждом жесте):
  `singleClick` (дефолт) — папку переключают клик по имени и Enter (`list.select`
  эталона), `doubleClick` — только шеврон, → и двойной клик. На компактной
  строке клик по сегменту и делает его текущим, и переключает строку. Дерево
  Problems настройку пока не читает.
- `contrib/files/browser/fileOperationsService.ts` — файловые операции поверх
  `WorkspaceEditService`/`DialogService`/`UndoRedoService`/`IFileClipboard`:
  `runCreate`/`runRename` (промпт имени через узкий шов
  `IExplorerInputPrompt` — срез `QuickInputService.input`, в DI замкнут на
  `QuickInputServiceDIToken`; интерфейс оставлен ради фейков в тестах),
  `requestDeleteFile` (корзина/
  безвозвратно + подтверждения), `copySelected`/`cutSelected`/`paste`
  (+ `buildPasteEdits`), workspace-undo/redo, `resolveInputPath` (`~`, корень
  воркспейса).
- `contrib/files/browser/inputWidgetService.ts` — целевой сервис input-команд: держит
  активный `InputElement` (забирает его сам как контрибьютор в опросе
  `WorkbenchContextKeys.update()`) и
  исполняет курсор/правки/выделение/клипборд для него (читают экшены
  `browser/actions/inputActions.ts` под `when: inputWidgetFocus`).

## Bulk edit

`WorkspaceEditService` (`contrib/bulkEdit/browser/workspaceEditService.ts`) ходит на
диск через `IFileService` и это единственный исполнитель bulk edit — и для файловых
операций проводника, и для `workspace.applyEdit` расширений. Открытые буферы видит
через порт `IBulkEditBuffers` (`contrib/bulkEdit/common`: буфер, `"read-only"` или
`null` — «не открыт, правим по диску»), шаги документов забирает из их истории
(`applyExternalEditsDetached`) и складывает в ОДИН элемент `UndoRedoService`, который
ложится в историю всех открытых затронутых буферов (`pushWorkspaceElement`; файл,
открытый позже, принимает его через `adopt`; отказ отмены — тост
`UndoRefusalNotificationContribution`). Корзина — `TrashService` за `ITrashService`
(`platform/files/`). Контракт и люфты — [API-COVERAGE](../../public/API-COVERAGE.md), строка
`workspace.applyEdit`.
