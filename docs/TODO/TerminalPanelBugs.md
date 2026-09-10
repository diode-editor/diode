# Нижняя Panel и терминал — баги фокуса и жизненного цикла

Дефекты, найденные при e2e-тестировании MVP «панель консоли», закрыты
(BUG-1…6: фокус на скрытом/умершем терминале, Toggle Terminal после смерти шелла,
персист активной вкладки, скролл колесом; enabler `TUIDom.sendMouse` в
инспекторе). Механика фиксов — `PanelFocusContribution`, шов
`ITerminalFocusFallback`, состояние вьюпорта в `ITerminalSurface`; история — в git.
Фича и её архитектура — [IntegratedTerminal.md](IntegratedTerminal.md).

## Осталось

### [ ] Неудавшийся спавн шелла прилетает наружу необработанной ошибкой

На Windows-раннере CI клик по вкладке TERMINAL валит спавн PTY (node-pty у нас пока
Unix-only — по этой же причине `terminal.scenario.ts` объявляет
`skipOn: ["win32", "darwin"]`), и ошибка `File not found: ` уходит наружу через RPC
инспектора, а не гасится в `TerminalService`. Пользователь на неподдерживаемой
платформе увидит не «терминал недоступен», а падение действия.

Нашлось при e2e-тестировании #197: тест кликал по вкладке TERMINAL и краснел
только на Windows. Клик перевели на вкладку PROBLEMS
(`e2e/outputPanel.test.ts`), сам дефект остался.

## Непокрытое автоматизацией

Тема/ANSI-палитра, wide-chars, живой Ctrl+`` ` `` на tier kitty/csi-u и вся
кросс-платформенность (macOS/Windows) — см. «Дальнейшие шаги» в
[IntegratedTerminal.md](IntegratedTerminal.md).
