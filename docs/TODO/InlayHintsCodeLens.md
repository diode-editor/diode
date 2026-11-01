# Inlay hints и code lens: что не вошло в ядро

Ядро inlay hints — #934, шов extension host — #935; ядро code lens — #936, шов — #937. Устройство — [Editor.md](../arch/Editor.md#editorcontribinlayhints-inlay-hints), [code lens](../arch/Editor.md#editorcontribcodelens-code-lens).

- [ ] Tooltip подсказки по наведению: у редактора нет mouse-hover на вставках.
- [ ] Ctrl+клик по части метки (`location`, `command`) и подчёркивание активной части.
- [ ] Двойной клик по подсказке применяет `textEdits`.
- [ ] Провозить через шов extension host `tooltip`, `textEdits`, `location` и `command` частей: сейчас `IWireInlayHint` их не несёт, рисовать нечем.
- [ ] `resolveInlayHint` и кэш сессий подсказок в субпроцессе (`$resolveInlayHint`, `$releaseInlayHints`): вызывается перед показом tooltip и `textEdits`, до них не нужен.
- [ ] Кэш подсказок при переключении вкладок (`_inlayHintsCache` эталона): сейчас после открытия они приходят заново.
- [ ] Подсказки в диффе и OUTPUT: сейчас только редактор файла.
- [ ] Tooltip линзы (`command.tooltip`): у редактора нет mouse-hover на рядах зон.
- [ ] Кэш линз в storage (`codeLensCache.ts` эталона): сейчас после открытия линзы приходят заново.
- [ ] Перезапрос линз по фокусу и отмена по потере фокуса (`onDidFocusEditorText`/`onDidBlurEditorText` эталона).
- [ ] Линзы в диффе и OUTPUT: сейчас только редактор файла.
