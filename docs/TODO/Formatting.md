# [~] Formatting — prettier и выбор форматтера

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
  `contrib/format/browser/formatActions.ts`, **обе видны в палитре** по запросу `format`;
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

## [x] Шаг 1 — prettier как стоковое расширение

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

### Сделано

Запись `esbenp.prettier-vscode` 12.4.0 опубликована (`proxy-openvsx`, universal,
`support: partial`) — реестр [diode-editor.github.io#13], витрина
[marketplace#5]. Живой прогон на собранном бинаре: `Ctrl+K Ctrl+E` форматирует
`.md` (`#   Hello` → `# Hello`, `*  item` → `- item`), `.json`
(`{"a":1,   "b": [1,2,   3]}` → `{ "a": 1, "b": [1, 2, 3] }`) и `.ts`.

Спайк нашёл **два** пробела, и оба были блокерами, а не косметикой:

1. **ESM-расширения не поднимались вовсе.** prettier с 12.x — `"type": "module"`
   с `import … from "vscode"`; extension host грузил точку входа только через
   `createRequire`, а виртуальный `"vscode"` жил только в CJS-кэше, невидимом
   ESM-loader'у → `ERR_MODULE_NOT_FOUND`. Закрыто правилом эталона `isEsmEntry`
   (`.mjs`/`.cjs`/`"type"`) + `module.registerHooks` рядом с CJS-стабом.
   **Грабля отладки:** под `tsx` (а это и `npm start`, и тестовый субпроцесс
   харнесса) ESM-хук tsx уводит `"vscode"` в CJS-резолвер, и всё работает —
   дыра видна только на родном loader'е Node и на собранном бинаре. Тесты
   ESM-расширений поэтому гоняют субпроцесс через
   `subprocessLoader: "node"`.
2. **`TextDocument.offsetAt`/`positionAt`/`validateRange`/`validatePosition`
   были объявлены в `vscode.d.ts`, но не реализованы.** prettier строит
   минимальную правку через `positionAt`, вызов бросал TypeError, языковой шов
   его глотал — и формат документа возвращал пустой список правок, то есть
   выглядел как «менять нечего». Заодно поправлено молчание шва: сбой провайдера
   формата теперь уходит в лог.

Остальная поверхность, на которую prettier опирается, уже была (статус-бар со
значком, output-канал, `getConfiguration`, `createFileSystemWatcher` под
`.prettierrc`, `workspace.isTrusted`, `languages.match`, `Uri.joinPath`,
`CodeActionKind.SourceFixAll`, `createLanguageStatusItem`, встроенная команда
`setContext`). Размер vsix (3.5 МБ) в лимит проходит с запасом.

**Маршрут «библиотека из проекта» проверен живьём на собранном бинаре** (у
eslint он же — #311/#312). Расширение ищет `prettier` в `node_modules`
воркспейса, читает его `package.json` и грузит динамическим `import()`:

- `node_modules/prettier@3.3.3` в воркспейсе → формат работает. Это и есть
  доказательство: при сбое загрузки расширение НЕ откатывается на вшитый
  prettier, а просто перестаёт форматировать (`Prettier could not be loaded`),
  так что работающий формат = загрузилась библиотека проекта;
- `node_modules/prettier@1.12.1` → тост «Prettier: Version 1.12.1 is outdated»
  — то есть `package.json` проекта прочитан;
- `node_modules` нет → вшитый.

**Грабля замера:** в тестовом харнессе этот маршрут падает «Failed to load
module», потому что харнесс не поднимает workbench-contributions, а
`isValidVersion` расширения внутри своего `try` зовёт
`executeCommand("setContext", …)`. В приложении команда есть
(`SetContextCommandContribution`), и всё работает. Мерить этот путь надо на
бинаре, харнессом нельзя.

**Не закрыто, записано:** `window.showOpenDialog` в Diode нет, поэтому команда
`Prettier: Create Configuration File` (пикер папки) ничего не делает. Это
отражено в `support.limits` записи реестра и в
[матрице готовности](../public/API-COVERAGE.md); пикер папок — отдельная задача,
не prettier-специфичная. Там же записаны два члена `TextDocument`,
объявленные и не реализованные: `save` и `getWordRangeAtPosition`.

[diode-editor.github.io#13]: https://github.com/diode-editor/diode-editor.github.io/pull/13
[marketplace#5]: https://github.com/diode-editor/marketplace/pull/5

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

### Замерено после шага 1: порядок стабилен, prettier выигрывает

На `.ts` после установки prettier формат даёт **prettier**, а не tsserver
(`const   x=1` → `const x = 1;` — точка с запятой и 2 пробела отступа это
prettier; tsserver давал `const x = 1` без `;`). Замерено на собранном бинаре
двумя прогонами с прогревом 25 с и 45 с — результат одинаковый.

Порядок не случайный и не гонка: стартовые события фаерятся детерминированно
(`onLanguage:*` активного редактора → `onStartupFinished`), но решает не порядок
активации, а порядок РЕГИСТРАЦИИ провайдера. prettier регистрирует его
синхронно в `activate()`, а LSP-клиент — только после хендшейка с сервером, то
есть секундами позже. Поэтому prettier первый при любом разумном прогреве.

Результат разумный: пользователь, поставивший prettier, именно этого и хочет.
Поэтому **пункт остаётся открытым и ждёт жалобы** (решение пользователя —
систему выбора форматтера сейчас не делать). Когда укусит:

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
