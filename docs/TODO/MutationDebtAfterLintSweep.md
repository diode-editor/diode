# Мутационный долг после линт-прогона (#333)

Статус: `[ ]` открыта.

## Откуда взялось

PR #333 («гейт typecheck + eslint в CI») привёл репозиторий под линтер: 1453
ошибки, из них 1241 — автофиксом prettier и сортировкой импортов. Автофикс
тронул **598 `.ts`-файлов**.

`scripts/mutation-diff.mjs` считает скоуп **по изменённым строкам**. Строка,
которую prettier просто перенёс или которой дописал висячую запятую, для diff'а
изменённая — и попадает в мутационный скоуп вместе со своей логикой. В итоге
гейт впервые отмутировал большой пласт кода, который раньше в скоуп не попадал:
**71 выживший мутант, балл 87.16 при пороге 100**.

Обходного пути не нашлось: `git diff -w` скоуп не сужает вообще (598 файлов и
так, и так) — prettier меняет не только пробелы, но и переносы, скобки и
запятые.

По решению владельца порог `thresholds.break` в `stryker.config.json` **оставлен
равным 100**, а гейт на #333 пропущен разово: опускать храповик ради одного
PR — значит ослабить его всем последующим. Этот документ — список того, что
осталось добить, чтобы гейт снова проходил сам.

## Что уже закрыто в #333

Тестами, а не подавлением:

- `workbenchContextKeys.ts:177` — 10 мутантов. Ключ `filesExplorerFocus` не был
  покрыт ВООБЩЕ; добавлен тест на путь предков (фокус в проводнике / вне его /
  фокуса нет). Проверено узким прогоном: 11 killed, 0 survived.
- `scmGraphRows.ts:95,103` — 5 мутантов. Тесты проверяли цвета по позициям, но
  не инвариант «длина `styles` равна длине `text`»; добавлен он и посимвольная
  проверка бейджа `+N`.
- `autoClosing.ts:68`, `signatureLayout.ts:30` — 3 мутанта. Оказались моей
  перестраховкой: `arr[-1]` и так даёт `undefined` (в отличие от `.at(-1)`),
  так что guard был лишним — убран вместе с мутантами.

## Что осталось

### Группа А — строки, переписанные в #333

Долг самого PR: рерайты ради линта обнажили непокрытое поведение.

| Файл | Строки | Суть |
|---|---|---|
| `platform/extensionManagement/node/fileRegistrySource.ts` | 55, 100 | `{ cause: error }` никто не ассертит |
| `platform/extensionManagement/node/httpRegistrySource.ts` | 102, 142, 162 | то же |
| `api/common/languagesNamespace.ts` | 50, 51, 63 | `messageText`/`uriText` — разбор формы сообщения и uri |
| `api/common/languagesNamespace.ts` | 1067, 1068 | сужение результата провайдера code actions |
| `api/common/windowNamespace.ts` | 808, 814 | фолбэк `showTextDocument` без ответа хоста |
| `api/common/vscodeTypes.ts` | 598 | чужой uri-подобный объект в `RelativePattern` |
| `api/common/l10nNamespace.ts` | 15 | предикат позиционных аргументов |
| `browser/parts/editor/editorComponent.ts` | 785 | `holdsFocus` |
| `browser/parts/views/viewsService.ts` | 595, 603 | контекст меню контейнера |
| `contrib/scm/browser/graphViewComponent.ts` | 105 | выбор строки по id |
| `contrib/scm/browser/scmChangeTree.ts` | 56 | путь с ведущим `/` |
| `contrib/search/browser/searchResultTree.ts` | 45 | то же |
| `services/textfile/common/textFileModel.ts` | 707 | цель правки по умолчанию |
| `editor/common/viewModel/editorViewState.ts` | 1311 | выход за границы проекции |
| `editor/common/viewModel/lineOperations.ts` | 211 | `merged.at(-1)` |
| `platform/actions/common/menuRegistry.ts` | 98, 197 | порядок групп, резолвер подменю |
| `extensions/git/lib/dotGit.ts` | 26 | `.trim()` строк вывода |
| `extensions/git/lib/queryParse.ts` | 62 | `index?.startsWith` |

### Группа Б — давний непокрытый код

Логику НЕ трогали: prettier переставил строку, и она впервые попала в скоуп.
Это долг прошлых PR, всплывший наружу.

| Файл | Строки | Мутантов |
|---|---|---|
| `api/common/languagesNamespace.ts` (`stripSnippetPlaceholders`) | 484–489 | 6 |
| `api/common/windowNamespace.ts` | 269 | 3 |
| `contrib/gotoDefinition/browser/definitionService.ts` | 70 | 2 |
| `contrib/scm/browser/changesComponent.ts` | 138, 139 | 2 |
| `contrib/scm/browser/graphViewComponent.ts` | 99, 100 | 2 |
| `editor/common/model/indentationDetector.ts` | 100 | 1 |
| `editor/common/viewModel/editorViewState.ts` | 1298 | 1 |
| `editor/contrib/comment/lineComments.ts` | 78 | 1 |
| `platform/files/node/chokidarTreeWatcher.ts` | 103 | 1 |
| `browser/parts/views/viewsService.ts` | 522 | 1 |
| `services/history/browser/historyService.ts` | 214 | 1 |
| `extensions/git/lib/classifyGitError.ts` | 29 | 1 |

## Как закрывать

Порядок конвенции (AGENTS.md): мутанта либо убиваем тестом, либо гасим
`// Stryker disable next-line <мутатор>: причина` — но не ассертом ради балла.
Эквивалентных мутантов здесь заметная часть (например `<` против `<=` на пути
без ведущего `/`), их честный исход — именно `Stryker disable` с причиной.

Порог трогать не нужно — он и так `100`. Признак «закрыто»: `node
scripts/mutation-diff.mjs <base> --ignoreStatic` на ветке с этими правками
проходит без выживших.

Смежное: [MutationGateFlake](MutationGateFlake.md) — гейт на неизменном коммите
даёт разные наборы выживших; часть разброса может приходить оттуда.
