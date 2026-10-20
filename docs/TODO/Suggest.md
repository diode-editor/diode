# Suggest — автодополнение и панель описания

Статус: **[~] итерация «suggest × LSP» сделана** — подсказки стокового
`typescript-language-server` доезжают до попапа, список сортируется и фильтруется по
серверным данным, панель описания включается тумблером, авто-импорт применяется вместе со
вставкой. Устройство и авто-открытие (quick suggest) — [arch/workbench/EditorWidgets.md](../arch/workbench/EditorWidgets.md#suggest). Открыто — «Дальше».

Контекст стека и грабли LSP-стороны — [LSP.md](LSP.md), раздел «Автодополнение».

## Что где живёт

| Слой | Файлы |
|---|---|
| Виджет | `@tuidom/elements/completionlist/`: `completionListElement.ts` (список), `completionDetailsElement.ts` (панель), `completionWidgetElement.ts` (контейнер, он же элемент оверлея) |
| Логика | `src/vs/workbench/contrib/suggest/browser/`: `completionService.ts`, `suggestComponent.ts`, `suggestActions.ts` |
| Контракт ядра | `src/vs/editor/common/languages/iCompletionSource.ts` |
| Транспорт | `src/vs/workbench/api/common/wireTypes.ts`, `languagesNamespace.ts`, `src/vs/workbench/services/extensions/node/extensionHost.ts` |

## Дальше

- **Сниппет-сессия** — табстопы, Tab/Shift+Tab по плейсхолдерам, Esc из сессии. Сейчас
  плейсхолдеры вырезаются.
- **Markdown в описании** — рендерера markdown в tuidom нет; документация показывается
  как текст.
- **Скролл панели** — длинное описание обрезается по высоте списка.
- **Отмена resolve** — resolve пункта идёт без токена (ответ кэшируется и общий у панели описания и accept); ограничен только сроком ответа. Сам запрос списка отменяется сразу: токен билета `LatestRequest` доезжает до провайдера (H2).
- **`commitCharacters`** — клиент объявляет их серверу, ядро не использует.
- **Word-based подсказки — лимит или воркер.** `completionService` на каждый запрос
  берёт `getText()` всех открытых документов и проходит их целиком: на 13 МБ файле это
  строка всего текста на каждую подсказку (A4, [VscodeModel](VscodeModel.md) оставил её
  как есть). Эталон считает слова в воркере редактора (`textualSuggest`), а набор
  документов задаёт настройка `editor.wordBasedSuggestions`.
