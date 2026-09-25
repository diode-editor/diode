# Призрачные подсказки (inline completions / ghost text)

Статус: v1 сделана — `vscode.languages.registerInlineCompletionItemProvider`
end-to-end: рендер серым курсивом за кареткой и В СЕРЕДИНЕ строки (+ view zones
под многострочные),
`InlineCompletionsService` с автозапросом на правку, Tab принимает
(`editor.action.inlineSuggest.commit`), Esc гасит, настройка
`editor.inlineSuggest.enabled`. Имена команд/ключей/цветов — дословно vscode
(сверено с тегом 1.127.0). Демо — фикстурное расширение
`e2e/fixtures/user-data-with-inline-ghost` (канированный «LLM» с задержкой) +
сценарий `inlineCompletion` + функциональный `e2e/inlineCompletions.test.ts`.

## Настройки триггера и таймаута

Три ключа в `editor.inlineSuggest.*`, все читаются НА КАЖДОМ обращении —
правка `settings.json` применяется без перезапуска (конфиг живой: watcher →
`ConfigurationService.reload`):

| ключ | дефолт | что делает |
|---|---|---|
| `enabled` | `true` | гейтит **только автозапрос**; команда trigger работает всегда |
| `delay` | `50` | пауза перед авто-запросом после правки, мс |
| `requestTimeout` | `5000` | сколько ждать ответ провайдера, мс |

`enabled: false` — это и есть «ручной режим»: подсказка приходит только по
`editor.action.inlineSuggest.trigger` (**Alt+\\**). Так же гейтит и upstream —
там `enabled` не влияет на команду-триггер.

Имена `delay`/`requestTimeout` — **наши**: в vscode 1.127 таких ключей нет
(дебаунс там адаптивный и зашит константой, а таймаута ответа нет вовсе —
вместо него `CancellationToken`). Похожий по имени upstream-ключ
`editor.inlineSuggest.minShowDelay` — про другое: он задерживает *показ* уже
полученного ответа, запрос уходит сразу. Образец имени `delay` —
`editor.quickSuggestionsDelay`.

Alt+\\ тоже не из ядра vscode (там у команды клавиши нет) — комбинация
приходит от расширения GitHub Copilot; взята, потому что пользователь её знает
и конфликта у нас нет. Терминал шлёт её как ESC + `\`, tuidom разбирает в
`{key: "\\", altKey: true}` — проверено на живом кадре.

`requestTimeout` едет в **самом запросе** (`IInlineCompletionRequest.timeoutMs`),
а не фиксируется при создании хоста, как остальное семейство таймаутов
(`completionTimeoutMs`, `hoverTimeoutMs`, …). Асимметрия осознанная: этот
таймаут человек правит руками и ждёт эффекта сразу. Негодные значения
(строка, `NaN`, отрицательное) откатываются на дефолт — редактор стартует и
ведёт себя как без настройки (`readMillisecondsSetting`).

Демо-фикстура умеет две ручки под ручную проверку: `inlineGhost.responseDelay`
(насколько «медленный» провайдер) и канал OUTPUT «Inline Ghost» — по строке на
запрос, по нему видно и число запросов при наборе, и `triggerKind`.

Архитектура: рендер — docs/arch/Editor.md («Ghost text»), шов —
docs/arch/Extensions.md («Inline-completion seam»).

## Осознанные отличия v1 от upstream (люфты)

- ~~**Каретка только в конце строки.**~~ Закрыто (заявка n-4): первая строка
  подсказки вклеивается фантомными колонками в layout строки каретки
  (`ILinePhantom`, `browser/textViewRendering.ts`), хвост строки уезжает вправо, и
  по той же композитной строке считают колонки overlay-проходы этой строки —
  подсветка токенов хвоста, фоны диапазонов, волны диагностик, каретки, hit-test.
  Остаточные люфты этой механики:
  - **Многострочная подсказка mid-line**: хвост строки остаётся на строке каретки
    (после `lines[0]`), а не уезжает под последнюю строку фантома, как у upstream —
    зона несёт только фантомный текст, документной строке в неё не переехать.
  - **Word wrap подсказку не переносит**: перенос считается по настоящему тексту
    строки, поэтому фантом с хвостом могут выйти за правый край и склиппиться
    (upstream пере-заворачивает строку с injected text).
  - **Каретка ровно на границе фрагмента wrap** с фантомом остаётся без
    аппаратного курсора на кадр (фантом рисуется в конце предыдущего ряда, а
    каретка адресуется следующим — то же отсутствие cursor affinity, что в
    docs/TODO/WordWrap.md).
- **Нет отмены RPC.** У upstream настоящий `CancellationToken` через границу;
  у нас — дебаунс (`delay`, дефолт 50 мс) + seq-гард + таймаут (`requestTimeout`,
  дефолт 5000 мс).
- **`selectedCompletionInfo` не поддержан.** При открытом suggest-попапе ghost
  не запрашивается (показанный ДО попапа — остаётся); закрытие попапа
  (`CompletionService.onDidClose`) перезапрашивает подсказку, так что Esc по
  попапу сразу приводит призрака. Upstream идёт дальше: показывает
  «augmentation» выбранного пункта и пере-запрашивает провайдеров на каждую
  смену выбора.
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
- **Движение каретки гасит подсказку** (живая сессия пере-показывается только на
  правке — `onCaretChanged`); upstream пере-фильтрует по `isVisible` и умеет
  rebase кэша ответов по правкам (`createStateWithAppliedEdit`).
- **`range.end` правее каретки не заменяется**: принятие вставляет текст в
  диапазон `range.start`..каретка, хвост строки остаётся как есть (upstream
  заменяет весь `range` и показывает это в ghost text). Для mid-line подсказок с
  таким `range` это разойдётся с ожиданием провайдера.
- **Частичное принятие** (`.acceptNextWord` Ctrl+Right / `.acceptNextLine`),
  `additionalTextEdits`, мульти-курсорные secondary edits — не в охвате.
- **Табы в строках-зонах** (`lines[1..]`) выравниваются по колонкам самой
  подсказки, а не экрана (`DisplayLine` строится от текста подсказки); зоны
  игнорируют `scrollLeft` и клиппятся по JS-символам (унаследовано от
  zone-рендера — см. Editor.md). В `lines[0]` этого люфта больше нет: она часть
  композитной строки, и таб добивает до экранной границы.
- **Настройки** — `enabled`, `delay`, `requestTimeout` (см. выше);
  `.showToolbar`, `.syntaxHighlightingEnabled` (подсветка фантома
  токенизатором), `.suppressSuggestions`, `.suppressInSnippetMode`,
  `.minShowDelay`, `.fontFamily` и inline edits (NES) — нет. Графической
  страницы настроек нет — только `settings.json` и его автодополнение.

## Часть 2 — реальный провайдер

Интеграция настоящего LLM-провайдера: отдельное расширение по рецепту
ruff/basedpyright-стека (платформенные vsix, магазин) либо builtin с
HTTP-клиентом. Понадобится решить активацию (сегодня только
`*`/`onStartupFinished`/`onLanguage:*`) и, вероятно, дебаунс/отмену на стороне
расширения.
