# EnglishCode — код по-английски

Решение человека 2026-10-21: код переводим на английский, доки остаются по-русски. Правила, храповик и глоссарий → [STYLE.md, язык кода](../STYLE.md#язык-кода).

Что остаётся по-русски: `*.md`, `.claude/` целиком, коммиты и PR. Не трогаем: `//@diode:vendored`, `vscode.d.ts`, нарочную кириллицу (тест юникода, кириллический ввод).

Нарезка повторяет чистку комментариев (#704–#724). Число в скобках — строки с кириллицей в срезе на старте (`scripts/cyrillic-baseline.json`, все виды вместе). Каждый PR волны в конце опускает базу (`npm run cyrillic-check -- --update`); конфликт в базе при ребейзе решается тем же `--update` поверх main.

## Волна 0 — подготовка

- [x] храповик `npm run cyrillic-check` в job `static`, `check-comments-only --no-cyrillic`, правило в AGENTS.md, глоссарий в STYLE.md

## Волна 1 — комментарии

Только комментарии; гейт PR — `node scripts/check-comments-only.mjs origin/main --no-cyrillic`. Названия тестов и строки — не здесь (волны 2–3), даже если рядом.

- [x] `src/vs/base` (751) — #726
- [x] `src/vs/platform` a–e: actions…extensionManagement (1365) — #730
- [x] `src/vs/platform` f–z: extensions…workspace (1620) — #731
- [x] `src/vs/editor`: core, diff, languages, services, contrib, test (1160) — #727
- [x] `src/vs/editor`: browser, viewModel, model, tokens (1923) — #732
- [x] `workbench/browser/parts` и `workbench/common` (2657) — #729
- [x] `workbench/browser`: верхний уровень и actions (1503) — #733
- [x] `workbench/services/extensions/node/extensionHost.*` (1308) — #734
- [x] `workbench/services/extensions`: остальное (1828) — #735
- [x] `workbench/services`: остальное (2563) — #736
- [x] `workbench/api`: browser, node, common a–l (1926) — #737
- [x] `workbench/api/common` m–z (1595) — #738
- [x] `workbench/contrib`: scm, terminal, tasks (1917) — #739
- [x] `workbench/contrib`: files, extensions, diff, search, suggest, parameterHints, inlineCompletions, quickaccess (2236) — #740 (+ долг мутанта в #743)
- [x] `workbench/contrib`: остальные фичи и прочее `workbench/` (1734) — #742
- [x] `src/vs/diode`, TestUtils, demos, StoryRunner, tools (904) — #741
- [x] `e2e/scenarios` (1052) — #744
- [~] `e2e`: остальное (1827)
- [x] scripts, extensions, packaging, `.github`, конфиги (2330) — уехал в общий PR волн 1+2+3, см. ниже

## Волны 2+3 — остальная кириллица, оптом по областям

Решение человека 2026-10-21 («можем это оптом делать. Максимальная скорость»): названия тестов, строки тестов и строки продукта — одним PR на область, после волны 1 в этой области. Гейт PR: CI зелёный, у файлов области в базе — только нарочная кириллица (список — в PR), число и вложенность тестов не изменились (`npx vitest list`). Строка UI, которая есть в vscode, — дословно из эталона.

- [~] `src/vs/base`, `src/vs/platform`, `src/vs/diode`, TestUtils, demos, StoryRunner, tools (2158)
- [~] `src/vs/editor` (1412)
- [~] `workbench/services` (2752)
- [~] `workbench/browser`, `workbench/common` (1861)
- [~] `workbench/api` (1982)
- [ ] `workbench/contrib` и прочее `workbench/` (3897) — после волны 1 files…quickaccess
- [ ] `e2e` (2879) — после волны 1 e2e
- [~] scripts, extensions, packaging, `.github`, конфиги (2344) — волны 1+2+3 одним PR

## Финал

- [ ] база содержит только нарочную кириллицу; список — в этом файле, задача уходит из трекера
