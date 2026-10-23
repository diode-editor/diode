# Флаки тестов и цена гейтов

Статус: `[ ]` открыта — живой список флаков и открытые ходы по цене полного прогона.

Как устроены гейты и почему они столько стоят — [docs/MUTATION.md](../MUTATION.md#цена-прогона-и-инкрементальный-режим)
и [docs/TESTING.md](../TESTING.md#прогон-сборка-воркеры-автоповтор-уборка).

## Порядок работы с флаком

Цель — флак копится в списке, а не стоит каждому следующему PR перезапуска CI.

1. **Поймал** (упал тест вне диффа, на соседних прогонах зелёный): `gh run rerun <run id> --failed`.
2. **Записал — в два места, прямо в `main`, без PR:**
   - `test-flakes.json` — файл от корня, полное имя `describe > … > it` (как в выводе vitest),
     `action: "retry"`, короткий `note` по-английски. С этого коммита vitest и dry run Stryker'а
     повторяют тест сами ([TESTING.md](../TESTING.md#список-известных-флаков-test-flakesjson-testutilsflaketestrunnerts));
   - строка в разделе [«Флаки»](#флаки) ниже — симптом, номер PR и ран. Уже есть — допиши новый ран:
     частота — главный довод, что чинить первым.

   `skip` вместо `retry` — только тесту, который храповики не держит (сеть, порог по стенке).
   Списком не лечатся падение в `beforeAll` и необработанная ошибка после теста, а e2e его не читает —
   у таких в строке пометка «не в test-flakes.json».
3. **Видно, что жив:** прошедший с повтора тест печатает аннотацию `Known flake retried` в job `test`.
4. **Починил** — удали запись из `test-flakes.json` и строку отсюда в том же PR. Тест переименован —
   запись правится там же, иначе `testFlakes.test.ts` покраснеет.

## Флаки

Известные флаки юнит-набора и e2e; PR-диффом не задеты, `gh run rerun --failed` зеленит. Юнит-тесты
отсюда стоят в `test-flakes.json`, кроме помеченных.

- [ ] `workbench.encoding.test.ts` › «Save with Encoding on an untitled buffer goes to Save As with the
  encoding set»: `ENOENT: no such file or directory, open '…/untitled-out.txt'` — файл читается раньше,
  чем Save As его дописал. Свалил dry run мутаций (`There were failed tests in the initial test run`)
  на ветке PR 1 этапа 2 OpenPerformance (ран 39853223940, дифф — рендер редактора).
- [ ] e2e `inline-completion` (не флак — детерминированно от **имени ветки**): на 100 колонках имя
  ветки в статус-баре плюс «Initializing JS/TS language features…» выталкивают «Ln…, Col 43» за край,
  и последний шаг ждёт его 4 с впустую. На `main` имя короткое; ветка
  `worktree-open-perf-stage2-occurrences` (37 символов) валила оба прохода, тот же бинарь с `main` —
  тоже. Обход — короткое имя ветки; починка — ждать результат не по статус-бару.
- [ ] `extensionHost.goLsp.test.ts` › «ExtensionHost — stock golang.go (gopls, end to end)»: сеть —
  `https://open-vsx.org/…/golang.Go-0.56.1.vsix: no data for 30000ms` в `beforeAll`, следом
  `Cannot read properties of undefined (reading 'dispose')` в `afterAll`. Job `test` на #753
  (ран 39653146369, PR меняет только тексты в contrib). Не в test-flakes.json: падает `beforeAll`
  (сеть), повтор теста его не повторяет — лечится кэшем `.vsix`.
- [ ] `explorerComponent.decorations.test.ts` › «свёрнутая папка с изменённым файлом глубоко внутри
  — цвет файла и «●»»: `expected '  old\n  pkg/a/b\n C.java\n …' to contain 'util.ts'`. Локально
  на main — 4 из 10. Валит и job `test`, и dry run мутаций (`There were failed tests in the initial
  test run`): #648, #656, #657, #663 (съел вердикт гейта), #678 — дважды подряд.
- [ ] `editorElement.performance.test.ts` › «combined render frame: contentWidth +
  buildVisibleLines × 100 cursor moves — must be fast»: порог 100 мс по стенке, на нагруженном
  раннере выходит за него. Самый частый флак (≈17 сессий за 12–20.10). Кандидат на перевод с
  порога стенки на счётчик работы. Соседний кейс того же файла «buildVisibleLines: cached by
  versionId — 100 render frames must be fast» флакует так же: 131 мс на #734 (ран 39615191048).
  И «first contentWidth on open is bounded by the cap, not the line length»: 206 мс при пороге
  100 на #738 (ран 39631082198).
- [ ] `fileSearchService.integration.test.ts` › «indexes files in nested directories»: ловили
  несколько сессий 18–20.10. В полном прогоне под нагрузкой `platform/` нет в выдаче `search("", 2000)`
  все три попытки подряд, отдельно файл зелёный. Не в test-flakes.json: индекс строится в
  `beforeAll`, повтор теста видит тот же индекс.
- [ ] `treeWatcherMain.integration.test.ts` › «правка файла на диске доезжает до колбэка в процессе
  редактора»: `expected 'changed' to be 'created'` — похоже, первым долетает событие создания
  файла, а не правки.
- [ ] `workbench.fileCreate.test.ts` › «create via context menu › New File... entry prompts and
  creates a file»: `expected false to be true`. Уронил dry run мутаций на #662 (ран 39231486646).
  Соседний кейс «New Untitled File › routes Save on an untitled buffer into Save As and writes the
  chosen path» падает так же: job `test` на #738 (ран 39623475810, PR меняет только комментарии).
  Третий кейс «New File / New Folder › creates a file next to a clicked file» уронил dry run
  мутаций локально (ветка фазы 3 PreviewEditors, файл не тронут; отдельно зелёный).
- [ ] `workbench.saveConflict.test.ts` › «saves without a prompt when the file was not changed
  externally» изредка роняет vitest необработанным `FileOperationError: ENOENT … lstat …/doc.txt`
  уже после теста: проверка конфликта сохранения дёргает `stat` по каталогу, который тест успел
  удалить. В #602 покрасил job `test` (все тесты зелёные, «Errors 1 error») и дал мутанту
  `profileExtensions.ts:248` вердикт `runtime-error` («vitest вышел кодом 1 без упавших тестов»);
  повторился на #660. Чинить в тесте или сервисе сохранения (дождаться проверки до уборки
  каталога), а не в гейте. Не в test-flakes.json: ошибка прилетает после теста, повтор не поможет.
- [ ] `workbench.preferences.test.ts` › «рекордер пишет комбинацию»: 2 из 4 dry run'ов Stryker'а на
  одном коммите (`vi.waitFor` с дефолтным таймаутом 1 с ждёт файл на диске); отдельно файл 3/3
  зелёный. Общий случай — ход «таймауты `vi.waitFor`» ниже.
- [ ] e2e-сценарий `settings-completion` (ubuntu): `waitUntil(screen text predicate) timed out after
  4000ms` на ожидании попапа `editor.` — упал дважды (с автоповтором) на #678 и снова дважды на #787
  (ран 39947482759; дифф — фолдинг, автодополнения настроек не касается; перезапуск job'а зелёный);
  на #795 (ран 40006403681, дифф — манифест git-base и скрипты импорта) упал на первом прогоне и прошёл на
  автоповторе.
- [ ] e2e-сценарий `region-folding` (ubuntu): `the provider fold did not appear in 20 attempts` — дважды
  (с автоповтором) на #795 (ран 40006403681; дифф — манифест git-base и скрипты импорта, фолдинга не
  касается); локально на том же коммите сценарий зелёный за 14 с, перезапуск job'а зелёный. Провайдер
  стокового `maptz.regionfolder` (`onStartupFinished`) на медленном раннере не успевает за 20 попыток чорда.
- [x] e2e-сценарий `explorer-compact-segments` (windows): `waitUntil(screen text predicate) timed out
  after 10000ms` — дважды (с автоповтором) на #714 (ран 39587566978), дифф — только комментарии в
  editor, на первом прогоне того же PR зелёный. Причина — баг `QuickInputService.input`: Enter гейтился
  сообщением на экране, а оно ещё от прошлого текста («Please enter a name» для пустого), пока
  асинхронная проверка `exists` для набранного имени не вернулась (на windows диск медленнее); Enter
  молча терялся. Теперь, как у эталона, Enter ждёт проверки именно этого текста.
- [ ] e2e-сценарий `searchNextResult` (`scenarios-1`): `waitUntil(screen text predicate) timed out after
  10000ms` (`searchNextResult.scenario.ts:32`) — windows на ране 39858081412 (ветка ExtensionUpdates
  этапа 0), ubuntu на #784 (ран 39874481793); оба диффа — установка расширений, поиск не трогают. Не в
  test-flakes.json: e2e его не читает.

- [ ] `externalOpenerService.test.ts` › «spawnDetached › a real process starts and gets its arguments»:
  `expected '' to be 'ok'` — `waitForFile` ждёт появления файла-маркера, а дочерний node ещё не дописал
  его содержимое; гонка существования и содержимого. Ран 39927690627 (PR 2 этапа 2 OpenPerformance,
  дифф — проекция редактора).

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

## Долг мутаций после EnglishCode (перевод кода на английский)

- [ ] PR волн EnglishCode (#726–#754) правили строки по всему коду, и гейт, считающий скоуп по строкам,
  мутировал давний код. По решению человека 2026-10-21 («мутационные гейты можно скипать») PR
  вливались, не дожидаясь `mutation`; порог оставлен 100. Известные выжившие:
  - `src/vs/workbench/browser/parts/editor/editorPartComponent.ts:193:21` — охраняющий `throw`
    → `false` (ConditionalExpression), вероятно эквивалентный; `:193:62` — текст сообщения → `""`
    (StringLiteral, нет ассерта) — #750.
  - Остальные PR влиты до конца `mutation`: признак «закрыто» — `npm run test:mutation -- --base 407cc622`
    (main сразу после #725, до волн) без выживших в файлах, тронутых только переводом.

## Долг мутаций после чистки комментариев #710

- [x] #710 снял хвостовые комментарии с двух строк, и гейт отмутировал давний код: 2 выживших
  (`real`), гейт на PR пропущен разово по решению человека, порог оставлен 100.
  - `src/vs/workbench/contrib/files/browser/fileOperationsService.ts:270` — `if (trimmed === oldName) return`
    → `if (false)`: не эквивалентный — без раннего выхода в undo ложится шаг «Rename» файла в самого
    себя; убит тестом.
  - `src/vs/workbench/contrib/suggest/browser/collectWordCompletions.ts:28` — `text.length > maxBytes`
    → `>=`: убит тестом на источник ровно в `maxBytes`.
- [x] #714 (editor) снял хвостовой комментарий с одной строки — 2 выживших (`real`), гейт на PR
  пропущен разово по решению человека, порог 100.
  - `src/vs/editor/common/viewModel/editorViewState.ts:1899` — `return region.endLine > region.startLine`
    → `true` и `>=`: эквивалентны — правка начинается после `startLine` и удаляет не больше
    `endLine - startLine - 1` строк, регион схлопнуться не может; погашены `Stryker disable` с причиной.
