# Inlay hints и code lens: что не вошло в ядро

Ядро inlay hints — #934, шов extension host — #935. Устройство — [Editor.md](../arch/Editor.md#editorcontribinlayhints-inlay-hints).

- [ ] Tooltip подсказки по наведению: у редактора нет mouse-hover на вставках.
- [ ] Ctrl+клик по части метки (`location`, `command`) и подчёркивание активной части.
- [ ] Двойной клик по подсказке применяет `textEdits`.
- [ ] `resolveInlayHint`: вызывается перед показом tooltip и `textEdits`, до них не нужен.
- [ ] Кэш подсказок при переключении вкладок (`_inlayHintsCache` эталона): сейчас после открытия они приходят заново.
- [ ] Подсказки в диффе и OUTPUT: сейчас только редактор файла.
- [ ] Code lens: тот же вопрос про мышь и строки над кодом.
