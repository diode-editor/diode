# Editor Groups — сплиты области редактора

**Статус: сделано (#245, фазы 1–7 + API).** Полоса групп по одной оси (`Ctrl+\`,
фокус `Ctrl+1..5`/чорды, перенос/копия/join, resize/maximize, ось-тумблер, Open
to the Side), undo и модель — на документ (`TextFileModelRegistry` с ref-count),
find-виджет на группу, персист полосы (`workbench.editors.groups`); API
расширений — `ViewColumn`/`showTextDocument`/`window.tabGroups`/
`onDidChangeVisibleTextEditors`/`vscode.diff` поверх snapshot-протокола
`editor.layoutChanged`, document sync пер-модель + `editor.didClose`.
Спека (US-1…50, AS-1…20) и решения планирования — в git; конвенции —
[arch/Workbench.md](../arch/Workbench.md).

## Follow-up'ы (осознанные люфты реализации)

- **US-6: Quick Open `Ctrl+Enter`** (открыть выбранный файл beside) — требует
  альтернативного accept в контракте QuickAccess (`accept(item, {alternate})`
  через `QuickPickElement.onAcceptAlternate`); Explorer `Ctrl+Enter` и
  `revealDefinitionAside` уже работают через `openUri({group: "beside"})`.
- **US-32: read-only на документ.** Флаг живёт на view-state вкладки; две вкладки
  одного документа могут разъехаться по read-only (гейты правок при этом общие —
  модель одна). Перенос флага на модель — вместе с конфиг-слоем `files.readonly*`
  ([ReadonlyEditor](ReadonlyEditor.md)).
- **Дубль-работа при N вью документа**: `DocumentTokenStore` и folding-пересчёт —
  пер-компонент; консолидация в модель — по перф-сигналу.
- **US-44/45 (деградация хоткеев по tier)** — механика биндов с `when: tier == …`
  и чордов работает (юниты `commandAction`/`keybindingRegistry`); живая проверка
  на настоящем legacy-терминале — при ручном прогоне чек-листа.
- **Сплит untitled/дифф-вкладки** дублем не делится (реестр моделей — только
  `file:`): новая группа при сплите таких вкладок открывается пустой.
- **Контекстное меню вкладки** (`MenuId.EditorTitleContext`) отдаёт ядро VS Code;
  осознанно не сделано: **Pin / Keep Open** и **Reopen Editor With…** (нет ни
  preview-вкладок, ни редакторов-по-выбору), **вызов меню с клавиатуры**
  (элементы вкладок не `focusable`; нет и у VS Code), **меню на пустом месте
  полосы вкладок**.
