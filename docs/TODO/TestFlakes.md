# Флаки тестов и цена гейтов

Статус: `[ ]` открыта — живой список флаков и открытые ходы по цене полного прогона.

Флак, не задетый диффом PR: `gh run rerun <run id> --failed` и строка в разделе [«Флаки»](#флаки) —
прямо в `main`, без PR ([docs/PR.md](../PR.md#зелёный-ci-и-влитие)). Починенный флак из списка
удаляется. Как устроены гейты и почему они столько стоят — [docs/MUTATION.md](../MUTATION.md#цена-прогона-и-инкрементальный-режим)
и [docs/TESTING.md](../TESTING.md#прогон-сборка-воркеры-автоповтор-уборка).

## Флаки

Известные флаки юнит-набора и e2e; PR-диффом не задеты, `gh run rerun --failed` зеленит.

- [ ] `explorerComponent.decorations.test.ts` › «свёрнутая папка с изменённым файлом глубоко внутри
  — цвет файла и «●»»: `expected '  old\n  pkg/a/b\n C.java\n …' to contain 'util.ts'`. Локально
  на main — 4 из 10. Валит и job `test`, и dry run мутаций (`There were failed tests in the initial
  test run`): #648, #656, #657, #663 (съел вердикт гейта), #678 — дважды подряд.
- [ ] `editorElement.performance.test.ts` › «combined render frame: contentWidth +
  buildVisibleLines × 100 cursor moves — must be fast»: порог 100 мс по стенке, на нагруженном
  раннере выходит за него. Самый частый флак (≈17 сессий за 12–20.10). Кандидат на перевод с
  порога стенки на счётчик работы.
- [ ] `fileSearchService.integration.test.ts` › «indexes files in nested directories»: ловили
  несколько сессий 18–20.10.
- [ ] `treeWatcherMain.integration.test.ts` › «правка файла на диске доезжает до колбэка в процессе
  редактора»: `expected 'changed' to be 'created'` — похоже, первым долетает событие создания
  файла, а не правки.
- [ ] `workbench.fileCreate.test.ts` › «create via context menu › New File... entry prompts and
  creates a file»: `expected false to be true`. Уронил dry run мутаций на #662 (ран 39231486646).
- [ ] `workbench.saveConflict.test.ts` › «saves without a prompt when the file was not changed
  externally» изредка роняет vitest необработанным `FileOperationError: ENOENT … lstat …/doc.txt`
  уже после теста: проверка конфликта сохранения дёргает `stat` по каталогу, который тест успел
  удалить. В #602 покрасил job `test` (все тесты зелёные, «Errors 1 error») и дал мутанту
  `profileExtensions.ts:248` вердикт `runtime-error` («vitest вышел кодом 1 без упавших тестов»);
  повторился на #660. Чинить в тесте или сервисе сохранения (дождаться проверки до уборки
  каталога), а не в гейте.
- [ ] `workbench.preferences.test.ts` › «рекордер пишет комбинацию»: 2 из 4 dry run'ов Stryker'а на
  одном коммите (`vi.waitFor` с дефолтным таймаутом 1 с ждёт файл на диске); отдельно файл 3/3
  зелёный. Общий случай — ход «таймауты `vi.waitFor`» ниже.
- [ ] e2e-сценарий `settings-completion` (ubuntu): `waitUntil(screen text predicate) timed out after
  4000ms` на ожидании попапа `editor.` — упал дважды (с автоповтором) на #678.
- [ ] e2e-сценарий `explorer-compact-segments` (windows): `waitUntil(screen text predicate) timed out
  after 10000ms` — дважды (с автоповтором) на #714 (ран 39587566978), дифф — только комментарии в
  editor, на первом прогоне того же PR зелёный.

## Цена полного прогона

Полный проход гейтов перед сдачей на 4 ядрах — десятки минут, почти всё — мутационный гейт; dry
run Stryker'а идёт одним воркером с `bail: 1`, так что любой флак в нём — весь гейт с нуля.
Сделано: `--ignoreStatic` и `--incremental` локально, кэш incremental по ветке в CI, перепроверка
всех выживших вживлением, неизменяемая сборка e2e и тяжёлая полоса JVM, срок dry run 15 минут.
Удешевить один прогон мутанта нечем (MUTATION.md, «Цена прогона») — сокращать надо число прогонов.

- [ ] **Таймауты `vi.waitFor` там, где ждут диск или субпроцесс**, — поднять явно: 5 с не делают
  зелёный тест медленнее, а один упавший тест в dry run — весь гейт. Дефолтный `vi.waitFor` без
  таймаута — десятки мест (editorGroups, терминал).
- [ ] **Сузить dry run, когда дифф трогает «корневой» модуль.** `base/common/lifecycle.ts`
  импортирует почти всё, и dry run становится полным сьютом (~9.7k тестов, perTest-покрытие):
  на #678 ради одного алиаса — ~4 CPU-мин впустую и таймаут на грани.
- [ ] **Шардинг мутаций в CI** — матрица из N job'ов по файлам скоупа (`--mutate`-подмножество);
  wall делится на N, отчёт склеивается из N JSON.
- [ ] **`vitest.related: false`** в `stryker.config.json` (весь набор на мутанта) — рекомендованный
  самим Stryker'ом выход из промаха подбора тестов; раньше упирался в `difficult-move` из-за
  `// @ts-nocheck` песочницы (починено `disableTypeChecks: false`). Замерить цену job'а.
- [ ] Вынести предупреждение раннера `Vitest failed to find test files related to mutated files` в
  комментарий к PR: сейчас оно тонет в логе.
- [ ] Проверить, не теряются ли результаты по таймауту под нагрузкой (`concurrency: 50%` на
  2-ядерном раннере).
- [ ] **Тяжёлое — не на слабой машине.** Локально на слабой машине — юниты, lint, typecheck и
  инкрементальные мутации по тронутым файлам; полный `test:mutation`/`test:e2e` — в CI или на
  сильной машине под той же лизой (`claude-lease`).

С явной уступкой — только записав в правила:

- [ ] Ограничить e2e локально списком сценариев по области фичи, полный набор — в CI.

## Долг мутаций после линт-прогона #333

- [ ] #333 переформатировал 598 файлов, и гейт, считающий скоуп по строкам, впервые отмутировал
  давний код: 71 выживший, гейт на PR пропущен разово, порог оставлен 100 (прецедент —
  [MUTATION.md](../MUTATION.md#ограничение-о-котором-надо-знать)). Остаток (≈50 мутантов, таблицы
  по файлам и строкам) — `git show 3b4c91e7:docs/TODO/MutationDebtAfterLintSweep.md`; строки с тех
  пор могли уйти. Признак «закрыто» — `npm run test:mutation -- --base <ref>` по этим файлам без
  выживших.

## Долг мутаций после чистки комментариев #710

- [ ] #710 снял хвостовые комментарии с двух строк, и гейт отмутировал давний код: 2 выживших
  (`real`), гейт на PR пропущен разово по решению человека, порог оставлен 100.
  - `src/vs/workbench/contrib/files/browser/fileOperationsService.ts:270` — `if (trimmed === oldName) return`
    → `if (false)`: вероятно, эквивалентный (переименование в то же имя и так ничего не меняет) — проверить
    и погасить `Stryker disable` с причиной либо убить тестом.
  - `src/vs/workbench/contrib/suggest/browser/collectWordCompletions.ts:28` — `text.length > maxBytes`
    → `>=`: граница `maxBytesPerText` не проверена — тест на источник ровно в `maxBytes`.
- [ ] #714 (editor) снял хвостовой комментарий с одной строки — 2 выживших (`real`), гейт на PR
  пропущен разово по решению человека, порог 100.
  - `src/vs/editor/common/viewModel/editorViewState.ts:1899` — `return region.endLine > region.startLine`
    (правка внутри свёрнутого региона) → `true` и `>=`: нет теста на правку, схлопнувшую регион в
    пустой, — убить тестом либо погасить `Stryker disable` с причиной, если эквивалентен.
