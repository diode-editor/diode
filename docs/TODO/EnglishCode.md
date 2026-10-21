# EnglishCode — код по-английски

Решение человека 2026-10-21: код переводим на английский, доки остаются по-русски. Правила, храповик и глоссарий → [STYLE.md, язык кода](../STYLE.md#язык-кода).

Что остаётся по-русски: `*.md`, `.claude/` целиком, коммиты и PR. Не трогаем: `//@diode:vendored`, `vscode.d.ts`, нарочную кириллицу (тест юникода, кириллический ввод).

Нарезка повторяет чистку комментариев (#704–#724). Число в скобках — строки с кириллицей в срезе на старте (`scripts/cyrillic-baseline.json`, все виды вместе). Каждый PR волны в конце опускает базу (`npm run cyrillic-check -- --update`); конфликт в базе при ребейзе решается тем же `--update` поверх main.

## Волна 0 — подготовка

- [x] храповик `npm run cyrillic-check` в job `static`, `check-comments-only --no-cyrillic`, правило в AGENTS.md, глоссарий в STYLE.md

## Волна 1 — комментарии

Только комментарии; гейт PR — `node scripts/check-comments-only.mjs origin/main --no-cyrillic`. Названия тестов и строки — не здесь (волны 2–3), даже если рядом.

- [x] `src/vs/base` (751) — #726
- [~] `src/vs/platform` a–e: actions…extensionManagement (1365)
- [~] `src/vs/platform` f–z: extensions…workspace (1620)
- [x] `src/vs/editor`: core, diff, languages, services, contrib, test (1160) — #727
- [~] `src/vs/editor`: browser, viewModel, model, tokens (1923)
- [~] `workbench/browser/parts` и `workbench/common` (2657)
- [ ] `workbench/browser`: верхний уровень и actions (1503)
- [ ] `workbench/services/extensions/node/extensionHost.*` (1308)
- [ ] `workbench/services/extensions`: остальное (1828)
- [ ] `workbench/services`: остальное (2563)
- [ ] `workbench/api`: browser, node, common a–l (1926)
- [ ] `workbench/api/common` m–z (1595)
- [ ] `workbench/contrib`: scm, terminal, tasks (1917)
- [ ] `workbench/contrib`: files, extensions, diff, search, suggest, parameterHints, inlineCompletions, quickaccess (2236)
- [ ] `workbench/contrib`: остальные фичи и прочее `workbench/` (1734)
- [ ] `src/vs/diode`, TestUtils, demos, StoryRunner, tools (904)
- [ ] `e2e/scenarios` (1052)
- [ ] `e2e`: остальное (1827)
- [ ] scripts, extensions, packaging, `.github`, конфиги (2330)

## Волна 2 — тесты

Названия тестов (`it`/`describe`/`bench`), описания в `until(…)`, строки-данные тестов и e2e-фикстуры без нарочной кириллицы. Гейт PR: CI зелёный и список тестов не изменился числом и вложенностью (`npx vitest list` до и после). Срезы — те же, что в волне 1.

- [ ] срезы волны 1, по одному PR

## Волна 3 — строки продукта

Не-тестовый код: ошибки, логи, справка CLI (`cliArgs.ts`), тексты диалогов и уведомлений. Строка есть в vscode — берём её дословно. Ассерты на эти строки правятся в том же PR.

- [ ] `src/vs/base`, `src/vs/platform`, `src/vs/editor`, `src/vs/diode`
- [ ] `src/vs/workbench`, `extensions/`

## Финал

- [ ] база содержит только нарочную кириллицу; список — в этом файле, задача уходит из трекера
