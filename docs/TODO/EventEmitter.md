# Ошибка слушателя не локализована: один кинувший подписчик отменяет остальных и роняет процесс

Статус: `[ ]` открыта. Перенесено из GitHub issue #275 (закрыт, трекер задач — здесь).

## Что не так

Событий у нас много, а общего эмиттера нет: цикл `for (const listener of [...this.listeners]) listener(...)`
раскатан руками примерно в 34 файлах (`ContextKeyService`, `ProgressService`, `StatusBarService`,
`ThemeService`, `TextDocument`, `TextFileModel`, `PanelService`, `TokenizationRegistry`, …).
Ни один из них не локализует исключение слушателя. Последствий два:

1. **Один кинувший слушатель отменяет остальных.** Цикл обрывается на нём — подписчики, стоящие
   дальше в `Set`, события не получают вовсе. Порядок подписки становится значимым, хотя нигде
   не документирован.
2. **Исключение улетает мимо всех.** Часть эмиттеров зовут из `queueMicrotask` (коалесинг
   `ContextKeyService.onDidChange`) или из таймера (тикер `ProgressService`). Оттуда исключение
   не принадлежит никакому стеку: обработчика `uncaughtException` у нас нет, значит процесс
   умирает целиком. Терминал спасает `process.on("exit")` внутри tuidom, а сессия — нет.

В vscode ровно на этот случай `Emitter.fire` заворачивает каждого слушателя в try/catch и отдаёт
ошибку в `onUnexpectedError`. У нас `onUnexpectedError` уже есть (`src/vs/base/common/errors.ts`,
дефолтный обработчик пишет в `console.error`), но им пользуется только `assertFn`.

## Как нашли

Мутационным прогоном (#274). Мутант `if (entry.paneView === null) continue` → `if (false)` в
`ViewsService.refreshTitleActions` заставляет слушателя `ViewTitleActionsContribution` кинуть
внутри микротаска `ContextKeyService.flush`. Ни один тест при этом не падает — vitest записывает
189 unhandled error'ов, а Stryker'овский `vitest-runner` ломается на их сериализации
(stryker-mutator/stryker-js#6233). Поломка инструмента — отдельная история; здесь важно то,
что она вскрыла: исключение слушателя у нас не локализовано нигде.

## Что предлагается

1. `Emitter<T>` в `src/vs/base/common/event.ts` (форма vscode: `event` как свойство, `fire`,
   `dispose`), внутри `fire` — try/catch на слушателя с `onUnexpectedError`. Тест: слушатель,
   кинувший первым, не мешает второму получить событие; ошибка доезжает до `onUnexpectedError`.
2. Перевод хендмейд-эмиттеров на него по одному слою за заход; `ContextKeyService` и
   `ProgressService` первыми — они самые «горячие» по числу подписчиков.
3. Побочная польза: исчезнет копипаста `[...this.listeners]` (защита от отписки внутри
   слушателя) и разнобой в сигнатурах `onDidChange`.

Замер объёма: `grep -rl 'of \[\.\.\.this\.\w*[Ll]isteners\]' src --include=*.ts | grep -v test`.
