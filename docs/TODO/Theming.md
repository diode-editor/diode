# Темизация (color themes)

Статус: `[~]` — встроенные темы (verbatim из microsoft/vscode), пикер с live preview, live-reload по
`workbench.colorTheme`, альфа в цветах (tuidom 0.4.0) и темы от расширений с установкой из магазина
(#84, Catppuccin в публичном реестре) готовы. Устройство, схема потоков и решения по темам расширений —
[arch/Theme.md](../arch/Theme.md). Issues: #83, #84, #85.

## Открыто

- [ ] **Подсветка текущей строки** (`editor.lineHighlightBackground`, `editor.renderLineHighlight`) —
  отдельная фича редактора; токен объявлен без дефолта и виджетами не читается. Приёмка — Catppuccin
  Mocha `#cdd6f412`: едва заметный оттенок под кареткой, выделение поверх — смесь смеси, значения
  ячеек совпадают с `compositeOver(цвет, подложка)`.
- [ ] **Группировка пикера по типу темы** (dark / light / hc) разделителями, как у VS Code; сейчас тип —
  подпись справа. Понадобится с ростом списка за счёт расширений.
- [ ] **Раскомментировать недостающие ключи `IWorkbenchColors`** по мере того, как виджеты начинают их
  использовать: незаявленные ключи парсятся в модель, но типобезопасного `getColor` для них нет.
- [ ] `workbench.colorCustomizations` и `editor.semanticTokenColorCustomizations` — не поддержаны.
- [ ] `.tmTheme` (`tokenColors` строкой) — plist-парсер, только если такая тема попросится в реестр.
- [ ] Иконки (`iconThemes`, `productIconThemes`) — когда появится носитель иконок в Explorer.
