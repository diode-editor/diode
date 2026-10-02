# [ ] Formatting — prettier и выбор форматтера

Пункт 5 из [ParityBacklog](ParityBacklog.md): «prettier и форматирование кода —
нужна полная система». Охват **сужен пользователем**: сначала prettier, остальная
система потом.

Статусы: `[ ]` — открыта, `[~]` — в работе, `[x]` — сделана.

---

## Что уже есть (замерено живьём)

Своего форматтера у ядра нет намеренно — форматирует только провайдер расширения
(решение по открытому вопросу #196, см. [LSP.md](LSP.md), строка
`registerDocument(Range)FormattingEditProvider`). Поверх шва работают:

- команды `editor.action.formatDocument` (Shift+Alt+F, плюс досягаемый всюду
  чорд Ctrl+K Ctrl+E) и `editor.action.formatSelection` (Ctrl+K Ctrl+F) —
  `browser/actions/formatActions.ts`, **обе видны в палитре** по запросу `format`;
- `editor.formatOnSave` и `editor.codeActionsOnSave` как участники сохранения
  (`services/editor/browser/onSaveParticipants.ts`);
- range-формат, устаревший ответ отбрасывается, правки одним undoable-батчем.

Живой прогон (три файла, Ctrl+K Ctrl+E на каждом):

| файл     | результат                                                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a.ts`   | **форматируется**: `const   x=1` → `const x = 1`, `function  f( a:number ){return a}` → `function f(a: number) { return a }` (форматтер даёт встроенный tsserver) |
| `b.md`   | `No formatter for 'markdown' installed`                                                                                                                           |
| `c.json` | `No formatter for 'json' installed`                                                                                                                               |

То есть «форматтеры есть, но только там, где их приносит LSP-расширение»:
TS/JS — tsserver, Python — ruff ([305-ruff](LSP.md)). Markdown, JSON, YAML, CSS,
HTML не покрыты никем — ровно ту дыру и закрывает prettier.

---

## [ ] Шаг 1 — prettier как стоковое расширение

`esbenp.prettier-vscode` в курируемый реестр магазина. Затрагивает три
репозитория (реестр, сайт, витрина) — порядок и грабли в
[Marketplace.md](Marketplace.md).

Перед записью в реестр — **спайк на живом расширении** по образцу
[JavaLSP](JavaLSP.md) и спайка Supermaven: поднять `.vsix` руками, дойти до
`activate()` и до первого отформатированного файла, выписать пробелы API. По
таблице [LSP.md](LSP.md) всё, на что prettier опирается, уже есть
(`registerDocument(Range)FormattingEditProvider`, `getConfiguration`,
`createOutputChannel`, `createFileSystemWatcher` для `.prettierrc`,
`findFiles`, `createStatusBarItem`), поэтому ожидание — пробелов мало. Проверить
отдельно:

- **откуда берётся сам prettier.** Расширение предпочитает `prettier` из
  `node_modules` проекта и падает обратно на вшитый — путь «библиотека из
  проекта» у нас уже пройден на eslint (#311/#312), сверить с ним;
- **статус-бар `$(check) Prettier`** — это пункт 3 из
  [ParityBacklog](ParityBacklog.md) (значки), в статус-баре подмена уже есть;
- **размер .vsix** — после #365 артефакт качается потоком, лимит 256 МиБ, так что
  упереться не должны.

Закрывается демо-сценарием в `e2e/scenarios/` с `installVsix` по id из реестра
(конвенция «фича поверх стокового расширения закрывается стоковым расширением»,
AGENTS.md) — и обязательно на языке, которого не покрывает tsserver (md/json),
иначе сценарий проверит не prettier.

---

## [ ] Шаг 2 — конфликт форматтеров (делать, когда укусит)

**Риск, который принесёт шаг 1.** `languages.provideFormattingEdits`
(`api/common/languagesNamespace.ts:997`) выбирает провайдера так:

```ts
const docReg = formattingRegistrations.find((r) => matchDocumentSelector(r.selector, doc));
```

Первый матчащий по порядку регистрации. prettier объявляет себя форматтером и
для typescript/javascript — то есть на `.ts` окажутся ДВА провайдера (tsserver и
prettier), и кто выиграет, будет зависеть от порядка активации, а не от желания
пользователя. VS Code в этой ситуации выбирает по score и
`editor.defaultFormatter`, а при неоднозначности спрашивает.

Если шаг 1 покажет, что порядок стабилен и устраивает — пункт остаётся открытым
и ждёт жалобы. Если поплывёт — закрывать сразу:

- настройка `editor.defaultFormatter` (глобальная и `[language]`-скоупная);
- команда `editor.action.formatDocument.multiple` («Format Document With…») —
  пикер провайдеров;
- выбор в пикере пишется в `editor.defaultFormatter` для языка (как upstream);
- в проводе появляется ЛИЧНОСТЬ провайдера (сейчас ядро видит только правки):
  `provide` должен возвращать список доступных форматтеров с id расширения.

## [ ] Шаг 3 — остальная система (отложено)

- `editor.formatOnType` (форматирование по набору — отдельный шов: правка →
  запрос по строке);
- `editor.formatOnPaste`;
- `editor.formatOnSaveMode` (`file` / `modifications`) — требует диффа против
  git-версии, в ядре он уже есть;
- `files.trimTrailingWhitespace` / `insertFinalNewline` как участники
  сохранения рядом с format-on-save.
