# Призрачные подсказки (inline completions / ghost text)

Статус: v1 сделана — `vscode.languages.registerInlineCompletionItemProvider`
end-to-end: рендер серым курсивом за кареткой (+ view zones под многострочные),
`InlineCompletionsService` с автозапросом на правку, Tab принимает
(`editor.action.inlineSuggest.commit`), Esc гасит, настройка
`editor.inlineSuggest.enabled`. Имена команд/ключей/цветов — дословно vscode
(сверено с тегом 1.127.0). Демо — фикстурное расширение
`e2e/fixtures/user-data-with-inline-ghost` (канированный «LLM» с задержкой) +
сценарий `inlineCompletion` + функциональный `e2e/inlineCompletions.test.ts`.

Архитектура: рендер — docs/arch/Editor.md («Ghost text»), шов —
docs/arch/Extensions.md («Inline-completion seam»).

## Осознанные отличия v1 от upstream (люфты)

- **Каретка только в конце строки.** Рендер не умеет сдвигать хвост строки под
  фантом (upstream делает это injected-text-декорациями внутри layout строки);
  сервис просто не показывает подсказку mid-line. Закрытие — вставка фантомных
  колонок в отрисовку строки каретки + сдвиг overlay-математики этой строки.
- **Нет отмены RPC.** У upstream настоящий `CancellationToken` через границу;
  у нас — дебаунс 50 мс + seq-гард + таймаут 5000 мс (как у всех провайдеров).
- **`selectedCompletionInfo` не поддержан.** При открытом suggest-попапе ghost
  не запрашивается и не показывается вовсе; upstream показывает «augmentation»
  выбранного пункта и пере-запрашивает провайдеров на каждую смену выбора.
- **Lifecycle-хуки не реализованы**: `handleItemDidShow` / `handlePartialAccept`
  / `handleEndOfLifetime` / `$freeInlineCompletionsList`, идентичность
  `(pid, idx)`. Нужны провайдерам с телеметрией (Copilot); потребуют bucket-кэш
  идентичности как у code actions.
- **`InlineCompletionItem.command` после вставки не исполняется** (та же
  причина — нужен кэш идентичности пунктов).
- **Политика провайдеров упрощена**: все матчащие опрашиваются, ответы
  конкатенируются, показывается первый видимый пункт. Без `yieldsToGroupIds`-
  графа и цикла вариантов Alt+] / Alt+[ (`.showNext/.showPrevious`).
- **Матчинг — строгий префикс** (`range.start..caret` — префикс
  `filterText ?? insertText`); upstream минимизирует edit и матчит fuzzy
  (`computeGhostText`: LCS, режимы prefix/subword/subwordSmart).
- **Движение каретки гасит подсказку**; upstream пере-фильтрует по `isVisible`
  и умеет rebase кэша ответов по правкам (`createStateWithAppliedEdit`).
- **Частичное принятие** (`.acceptNextWord` Ctrl+Right / `.acceptNextLine`),
  `additionalTextEdits`, мульти-курсорные secondary edits — не в охвате.
- **Табы в фантоме** выравниваются по колонкам самой подсказки, а не экрана
  (DisplayLine строится от текста подсказки); зоны игнорируют `scrollLeft` и
  клиппятся по JS-символам (унаследовано от zone-рендера — см. Editor.md).
- **Настройки** — только `editor.inlineSuggest.enabled`; `.showToolbar`,
  `.syntaxHighlightingEnabled` (подсветка фантома токенизатором), `.fontFamily`
  и inline edits (NES) — нет.

## Часть 2 — реальный провайдер

Интеграция настоящего LLM-провайдера: отдельное расширение по рецепту
ruff/basedpyright-стека (платформенные vsix, магазин) либо builtin с
HTTP-клиентом. Понадобится решить активацию (сегодня только
`*`/`onStartupFinished`/`onLanguage:*`) и, вероятно, дебаунс/отмену на стороне
расширения.
