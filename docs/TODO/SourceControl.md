# Source Control — полный набор VS Code: staging, commit, sync, branch, stash

Цель: довести вьюлет Source Control до функциональности VS Code — группы ресурсов,
stage/unstage/discard (в т.ч. по множественному выделению), встроенный commit input box,
sync/branch/stash/remote-операции и меню «⋯» с подменю. Всё — через команды
(`CommandAction`), доступ из палитры и контекстных меню; inline-кнопок на строках нет
(осознанное отклонение от VS Code: hover в терминале доступен только мыши).

Этот документ — одновременно **спека** (номенклатура команд и меню), **приёмочный
чек-лист** (user stories US-1…US-32: при реализации каждая закрывается e2e-тестом, после
релиза по ним проводится ручное тестирование) и **трекер фазировки**.

Связанные решения: транспорт остаётся на приватных двусторонних командах (`scm`-неймспейс
vscode.d.ts не раскомментируем — см. [Diff.md](Diff.md), пункт F); одно репо, без
clone/init/мультирепо.

---

## Архитектурная рамка

- **Все user-facing `git.*`-команды живут в ядре** (`CommandAction` + `builtinActions.ts`):
  манифест расширений не умеет contributes.menus, а пикеры/диалоги — в ядре. Расширение
  регистрирует только приватные мосты `vexx.git.*` (одноимённая регистрация невозможна —
  `CommandRegistry` перезаписывает по id). Исключение: `git.refresh` уже зарегистрирован
  расширением и остаётся за ним.
- **Мосты**: мутации staging (`vexx.git.stage/unstage/clean` — списки uri), семантический
  диспетчер `vexx.git.op {op, params}` (не generic-exec: argv собирает расширение),
  запросы `vexx.git.query {kind: refs|stashes|remotes}` для пикеров, push-каналы
  `vexx.scm.publishChanges` (+`group`) и новый `vexx.scm.publishRepoState`.
- **Результат операции** — envelope `{ok:true} | {ok:false, kind, message, stderr}` с
  классификацией по stderr: `auth | conflict | dirty-worktree | push-rejected |
  no-upstream | not-merged | git-error`. Все сетевые вызовы — `GIT_TERMINAL_PROMPT=0`,
  timeout 60s; в расширении мьютекс мутаций (защита `.git/index.lock`), после каждой
  операции — немедленный refresh.
- **Repo-state → when-ключи**: `gitHasRepo, gitHasRemotes, gitHasUpstream, gitMerging,
  gitRebasing, gitDetached` из `git status --porcelain=v2 --branch` + fs-проверок
  (`MERGE_HEAD`, `rebase-merge|rebase-apply`, `CHERRY_PICK_HEAD`).
- **Группы ресурсов**: porcelain `xy` → 0..2 записей по группам
  `merge | index | worktree | untracked` (MM — в двух группах; unmerged-коды
  `DD/AU/UD/UA/DU/AA/UU` → merge; `??` → untracked). Порядок и заголовки как в VS Code:
  Merge Changes → Staged Changes → Changes → Untracked Changes, пустые группы скрыты.
- **Commit input box** — header контейнера Source Control над секциями
  (`IViewContainerDescriptor.header`), виджет на существующем `InputElement`, черновик
  персистится (workspace-scope). Ctrl+Enter — commit; в legacy-терминалах Ctrl+Enter
  неотличим от Enter — команды доступны из палитры, это единственный fallback.
- **Id строк списка** (e2e-селектор `#id` матчит только `[A-Za-z0-9_-]`):
  `scmGroup-<group>`, `scmRow-<group>-<sanitized-path>`, `scmDir-<group>-<sanitized-path>`.

---

## Команды

Условные обозначения: **when** — контекст-ключи repo-state (см. выше); базовый when всех
команд — `gitHasRepo`. «msg» — сообщение из commit input box (пустое → отказ, кроме
amend: пустое → `--no-edit`). Целевые (`git.stage/unstage/clean`) принимают явные uri из
меню, иначе берут выделение списка Changes и **фильтруют по применимости** групп.

### Staging

| id | title (палитра) | Поведение / git | Подтверждение | Применимость |
|---|---|---|---|---|
| `git.stage` | Git: Stage Changes | `git add -A -- <paths>` | — | worktree, untracked, merge |
| `git.unstage` | Git: Unstage Changes | `git reset -q HEAD -- <paths>`; unborn HEAD → `git rm --cached -r -q --` | — | index |
| `git.clean` | Git: Discard Changes | tracked → `git checkout -q -- <paths>`; untracked → `git clean -q -f -- <paths>` | confirm; для untracked — warning «DELETE … IRREVERSIBLE» | worktree, untracked |
| `git.stageAll` | Git: Stage All Changes | все worktree+untracked+merge из снимка | — | — |
| `git.unstageAll` | Git: Unstage All Changes | все index | — | — |
| `git.cleanAll` | Git: Discard All Changes | все worktree+untracked | confirm с количеством, раздельные тексты tracked/untracked/mixed | — |

На заголовке группы те же `git.stage/unstage/clean` показываются с per-placement title
«Stage/Unstage/Discard All Changes» и целями = вся группа. Диапазонные команды
(`git.stageSelectedRanges` и пр.) — вне скоупа (файловые операции only).

### Commit

| id | title | Поведение / git | when |
|---|---|---|---|
| `git.commit` | Git: Commit | commit индекса; пустой индекс → smart-commit-вопрос «Commit all changes?» | `gitHasRepo` |
| `git.commitStaged` | Git: Commit Staged | `commit -m <msg>` | `gitHasRepo` |
| `git.commitAll` | Git: Commit All | `commit --all -m <msg>` (untracked не берёт, как VS Code) | `gitHasRepo` |
| `git.commitAmend` | Git: Commit (Amend) | `commit --amend` (`--no-edit` при пустом msg) | `gitHasRepo` |
| `git.commitStagedAmend` | Git: Commit Staged (Amend) | `commit --amend` | `gitHasRepo` |
| `git.commitAllAmend` | Git: Commit All (Amend) | `commit --all --amend` | `gitHasRepo` |
| `git.commitNoVerify` (+ Staged/All × Amend-варианты) | Git: Commit (No Verify) … | те же + `--no-verify` | `config.git.allowNoVerifyCommit` |
| `git.commitEmpty` | Git: Commit Empty | `commit --allow-empty -m <msg>` | палитра-only |
| `git.undoCommit` | Git: Undo Last Commit | guard: HEAD~ существует, HEAD не merge-коммит; `reset --soft HEAD~`, сообщение → input box | `gitHasRepo` |

Кейбинд: **Ctrl+Enter** при `scmInputFocus` → `git.commit`. Signed-off-семейство
(`git.commitSigned` и пр.) — отложено (низкий приоритет, `-s` тривиален).

### Sync

| id | title | Поведение / git | when |
|---|---|---|---|
| `git.pull` | Git: Pull | `pull` | `gitHasRemotes` |
| `git.pullRebase` | Git: Pull (Rebase) | `pull --rebase` | `gitHasRemotes` |
| `git.pullFrom` | Git: Pull from... | пикер remote → пикер ветки → `pull <remote> <ref>` | `gitHasRemotes` |
| `git.push` | Git: Push | `push`; исход no-upstream → предложить Publish | `gitHasRemotes` |
| `git.pushForce` | Git: Push (Force) | confirm → `push --force-with-lease` | `gitHasRemotes` |
| `git.pushTo` | Git: Push to... | пикер remote → `push <remote> HEAD:<branch>` | `gitHasRemotes` |
| `git.pushToForce` | Git: Push to... (Force) | + confirm + `--force-with-lease` | `gitHasRemotes` |
| `git.pushWithTags` | Git: Push (Follow Tags) | `push --follow-tags` | `gitHasRemotes` |
| `git.pushWithTagsForce` | Git: Push (Follow Tags, Force) | + confirm | `gitHasRemotes` |
| `git.sync` | Git: Sync | `pull` → `push` | `gitHasRemotes && gitHasUpstream` |
| `git.syncRebase` | Git: Sync (Rebase) | `pull --rebase` → `push` | то же |
| `git.fetch` | Git: Fetch | `fetch` | `gitHasRemotes` |
| `git.fetchPrune` | Git: Fetch (Prune) | `fetch --prune` | `gitHasRemotes` |
| `git.fetchAll` | Git: Fetch From All Remotes | `fetch --all` | `gitHasRemotes` |
| `git.publish` | Git: Publish Branch... | remote один → сразу, иначе пикер → `push -u <remote> <branch>` | `gitHasRemotes` |

Реакции на ошибки (единый хелпер ядра): `auth` → диалог «git не может спросить
credentials в фоне — настройте credential helper / ssh-agent»; `push-rejected` → «Push
rejected (non-fast-forward). Pull now?» → `git.pull`; `no-upstream` → «Publish branch?»;
`conflict` → notice в статус-бар, конфликтные файлы появляются в Merge Changes;
`git-error` → notice + stderr в Output.

### Branch

| id | title | Поведение / git | when |
|---|---|---|---|
| `git.checkout` | Git: Checkout to... | пикер: «Create new branch...», «Create new branch from...», «Checkout detached...» + локальные/remote-ветки (сорт -committerdate) + теги; remote → DWIM tracking, тег → detached | `gitHasRepo` |
| `git.checkoutDetached` | Git: Checkout to (Detached)... | пикер → `checkout --detach <ref>` | `gitHasRepo` |
| `git.branch` | Git: Create Branch... | input имени (валидация `check-ref-format --branch`) → `checkout -b` | `gitHasRepo` |
| `git.branchFrom` | Git: Create Branch From... | пикер base-ref → input → `checkout -b <name> <base>` | `gitHasRepo` |
| `git.renameBranch` | Git: Rename Branch... | input (prefill текущее) → `branch -m` | `!gitDetached` |
| `git.deleteBranch` | Git: Delete Branch... | пикер (без текущей) → `branch -d`; not-merged → «Delete anyway?» → `-D` | `gitHasRepo` |
| `git.deleteRemoteBranch` | Git: Delete Remote Branch... | пикер → `push <remote> --delete <branch>` | `gitHasRemotes` |
| `git.merge` | Git: Merge... | пикер ref → `merge`; конфликт → notice + Merge-группа | `!gitMerging` |
| `git.mergeAbort` | Git: Abort Merge | `merge --abort` | `gitMerging` |
| `git.rebase` | Git: Rebase Branch... | пикер → `rebase <branch>` | `!gitRebasing` |
| `git.rebaseAbort` | Git: Abort Rebase | `rebase --abort` | `gitRebasing` |
| `git.cherryPick` | Git: Cherry Pick... | input/пикер sha → `cherry-pick` | палитра-only, поздняя фаза |

### Stash

| id | title | Поведение / git | when |
|---|---|---|---|
| `git.stash` | Git: Stash | опц. input сообщения → `stash push [-m]` | `gitHasRepo` |
| `git.stashIncludeUntracked` | Git: Stash (Include Untracked) | `stash push -u [-m]` | `gitHasRepo` |
| `git.stashStaged` | Git: Stash Staged | `stash push --staged` (git ≥ 2.35, иначе понятная ошибка) | `gitHasRepo` |
| `git.stashPop` | Git: Pop Stash... | пикер → `stash pop <stash@{n}>` | `gitHasRepo` |
| `git.stashPopLatest` | Git: Pop Latest Stash | `stash pop` | `gitHasRepo` |
| `git.stashApply` | Git: Apply Stash... | пикер → `stash apply` | `gitHasRepo` |
| `git.stashApplyLatest` | Git: Apply Latest Stash | `stash apply` | `gitHasRepo` |
| `git.stashDrop` | Git: Drop Stash... | пикер + confirm → `stash drop` | `gitHasRepo` |
| `git.stashDropAll` | Git: Drop All Stashes... | confirm с количеством → `stash clear` | `gitHasRepo` |

При конфликте pop git не удаляет стэш — notice об этом.

### Remote / Tags

| id | title | Поведение / git | when |
|---|---|---|---|
| `git.addRemote` | Git: Add Remote... | input URL → input имени → `remote add` → `fetch` | `gitHasRepo` |
| `git.removeRemote` | Git: Remove Remote | пикер → `remote remove` | `gitHasRemotes` |
| `git.createTag` | Git: Create Tag | input имени → input сообщения (пустое → lightweight, иначе `-a -m`) | `gitHasRepo` |
| `git.deleteTag` | Git: Delete Tag | пикер → `tag -d` | `gitHasRepo` |
| `git.deleteRemoteTag` | Git: Delete Remote Tag | пикер remote → пикер из `ls-remote --tags` → `push --delete` | `gitHasRemotes` |

### Навигация и прочее

| id | title | Поведение |
|---|---|---|
| `workbench.scm.focus` | Source Control: Focus on Source Control View | показать вьюлет + фокус в commit input |
| `scm.action.focusChanges` | — (кейбинд Down при `scmInputFocus`) | фокус из input в список CHANGES |
| `git.showOutput` | Git: Show Git Output | открыть output-канал ext-host |
| существующие | `workbench.view.scm` (фокус в список), `scm.action.openFile/openChanges` (visible только при единственной resource-цели), `scm.action.viewAsTree/viewAsList`, `git.refresh` | без изменений поведения |

Вне скоупа: `git.clone`, `git.init`, `git.openRepository`, `git.close`,
`git.stageSelectedRanges`/`revertSelectedRanges`, `git.ignore`, timeline.

---

## Меню

### Контекстное меню строки файла (`MenuId.ScmContext`)

Пункт виден, если применим хотя бы к одной цели выделения; команда фильтрует цели.

```
1_open      Open File            (только единственная цель)
            Open Changes         (только единственная цель)
2_stage     Stage Changes        (worktree|untracked|merge в целях)
            Unstage Changes      (index в целях)
3_discard   Discard Changes      (worktree|untracked в целях)
```

Правый клик по строке в выделении — цели из всего выделения; вне выделения — из одной
строки. Меню на папке (режим дерева) — цели = файлы под папкой. Shift+F10 — то же меню
с клавиатуры.

### Контекстное меню заголовка группы (`MenuId.ScmResourceGroupContext`)

```
1_actions   Stage All Changes     (группы worktree/untracked/merge)
            Unstage All Changes   (группа index)
            Discard All Changes   (группы worktree/untracked)
```

### Меню «⋯» секции CHANGES (`MenuId.ViewMoreActions`, visible: секция CHANGES)

Отражение VS Code `scm/title` (минус clone/мультирепо):

```
1_view      View as Tree / View as List          ← существующие
2_git_top   Pull · Push · Checkout to... · Fetch
3_git_menus Commit ▸      → GitCommitMenu
            Changes ▸     → GitChangesMenu
            Pull, Push ▸  → GitPullPushMenu
            Branch ▸      → GitBranchMenu
            Remote ▸      → GitRemotesMenu
            Stash ▸       → GitStashMenu
            Tags ▸        → GitTagsMenu
9_footer    Show Git Output
```

Наполнение подменю (группы → автосепараторы; пустые подменю скрываются):

- **GitCommitMenu**: `1_commit` Commit, Commit (Amend) · `2_staged` Commit Staged,
  Commit Staged (Amend) · `3_all` Commit All, Commit All (Amend) · `4_noverify`
  (за конфигом) NoVerify-варианты · `5_undo` Undo Last Commit.
- **GitChangesMenu**: `1_changes` Stage All Changes, Unstage All Changes,
  Discard All Changes.
- **GitPullPushMenu**: `1_sync` Sync · `2_pull` Pull, Pull (Rebase), Pull from... ·
  `3_push` Push, Push (Force), Push to..., Push (Follow Tags) · `4_fetch` Fetch,
  Fetch (Prune), Fetch From All Remotes.
- **GitBranchMenu**: `1_integrate` Merge..., Rebase Branch... · `2_branch` Create
  Branch..., Create Branch From..., Rename Branch..., Delete Branch..., Delete Remote
  Branch...
- **GitRemotesMenu**: Add Remote..., Remove Remote.
- **GitStashMenu**: `1_push` Stash, Stash (Include Untracked), Stash Staged · `2_apply`
  Apply Latest Stash, Apply Stash..., Pop Latest Stash, Pop Stash... · `3_drop`
  Drop Stash..., Drop All Stashes...
- **GitTagsMenu**: Create Tag, Delete Tag, Delete Remote Tag.

В меню — `shortTitle` («Commit»), в палитре — `title` («Git: Commit»). Требуемая правка
инфраструктуры: `ISubmenuContribution.visible?: (ctx) => boolean` (привязка подменю к
секции через `viewMenuVisible` — when-ключ не годится, в сайдбаре видно несколько секций).

---

## User stories (приёмочный чек-лист e2e)

Формат: подготовка → шаги → ожидаемо. Общие фикстуры: git-репо на диске (как
`e2e/sourceControl.functional.test.ts::makeRepo`), для sync — локальный bare-remote
(`git init --bare` + `remote add origin <path>`, file-протокол без auth). Все ожидания —
settle-глаголами/предикатами (без sleep); git-ассерты (`execFileSync`) — строго после
UI-подтверждения. Ручной прогон после релиза — по этому же списку.

### Группы и staging

- **US-1. Группы ресурсов.** Репо: файл A staged (`git add`), файл B modified, файл C
  untracked, файл D staged+modified (MM). → Открыть Source Control. → Видны группы
  «Staged Changes 2», «Changes 2», «Untracked Changes 1» (D — и в Staged, и в Changes);
  порядок групп Merge → Staged → Changes → Untracked; группы сворачиваются
  (Enter/Space/клик на заголовке), счётчик остаётся виден.
- **US-2. Stage файла из контекстного меню.** Курсор на строке B в Changes → Shift+F10 →
  «Stage Changes» → Enter. → Строка переехала в Staged Changes; `git diff --cached
  --name-only` содержит B; счётчики групп обновились.
- **US-3. Unstage файла.** Курсор на строке A в Staged → контекстное меню → «Unstage
  Changes». → Строка вернулась в Changes; `git diff --cached` пуст по A.
- **US-4. Stage папки (режим дерева).** Режим View as Tree, две правки в `src/`. →
  Контекстное меню на папке `src` → «Stage Changes». → Оба файла в Staged;
  `git diff --cached --name-only` — ровно эти два.
- **US-5. Stage всей группы с заголовка.** Контекстное меню на заголовке «Changes» →
  «Stage All Changes». → Группа Changes исчезла (пуста), все файлы в Staged.
- **US-6. stageAll/unstageAll из палитры.** Ctrl+Shift+P → «Git: Stage All Changes» →
  Enter; затем «Git: Unstage All Changes». → После первого — всё в Staged (untracked
  тоже); после второго — index пуст, файлы вернулись в свои группы.
- **US-7. Multi-select клавиатурой и мышью.** Shift+Down ×2 от строки 1; отдельно —
  клик строка 1, Shift+клик строка 3. → В `inspectState` списка `selectedIds` содержит
  3 id; выделение подсвечено.
- **US-8. Ctrl+клик и групповая операция.** Выделить 3 строки → Ctrl+клик по средней
  (осталось 2) → Shift+F10 → «Stage Changes». → В Staged переехали ровно 2 выбранных
  файла; `git diff --cached --name-only` — ровно они.
- **US-9. Смешанное выделение.** Выделить staged-строку и worktree-строку → контекстное
  меню. → Видны и «Stage Changes», и «Unstage Changes»; «Stage» применяется только к
  worktree-цели, «Unstage» — только к staged (второй файл не тронут).
- **US-10. Discard tracked с подтверждением.** Контекстное меню на modified-строке →
  «Discard Changes» → в диалоге Cancel/Esc; повторить → Confirm. → После Cancel файл не
  изменился; после Confirm содержимое = HEAD, строка ушла из списка.
- **US-11. Discard untracked = удаление.** Контекстное меню на untracked-строке →
  «Discard Changes». → Диалог в warning-стиле с текстом про DELETE/IRREVERSIBLE и
  кнопкой «Delete File»; после подтверждения файл удалён с диска.
- **US-12. Составы контекстных меню.** Открыть меню на staged-строке / worktree-строке /
  untracked-строке / заголовках групп. → Наборы пунктов соответствуют разделу «Меню»;
  Esc закрывает меню без действий; при multi-select «Open File/Open Changes» скрыты.

### Commit input box

- **US-13. Input box на месте.** Открыть Source Control. → Над секцией CHANGES — поле с
  плейсхолдером «Message (Ctrl+Enter to commit)»; поле не участвует в
  сворачивании/перетаскивании секций.
- **US-14. Фокус-переходы.** `workbench.scm.focus` (палитра/кейбинд) → фокус в input;
  Down → фокус в список CHANGES; Tab циклит по вьюлету; `workbench.view.scm` — фокус в
  список (как раньше).
- **US-15. Черновик переживает рестарт.** Набрать «fix: typo» → закрыть приложение →
  открыть тот же workspace. → В input box «fix: typo».
- **US-16. Commit по Ctrl+Enter.** Staged-файл есть; в input «feat: msg» → Ctrl+Enter. →
  Input очистился; staged-группа пуста; `git log -1 --format=%s` == «feat: msg».
- **US-17. Smart commit при пустом индексе.** Индекс пуст, есть modified; Ctrl+Enter с
  сообщением. → Вопрос «Commit all changes?»; Confirm → закоммичены все tracked-правки;
  Cancel → ничего не произошло.
- **US-18. Пустое сообщение.** Пустой input → Ctrl+Enter. → Коммита нет (`git log`
  не изменился), понятная индикация (notice/диалог).
- **US-19. Amend.** Коммит есть; staged-правка; «Git: Commit Staged (Amend)». →
  `git log` — то же число коммитов, последний включает правку; при пустом сообщении
  прежнее сообщение сохранено (`--no-edit`).
- **US-20. Undo Last Commit.** После коммита из US-16 → «Git: Undo Last Commit». →
  HEAD откатился (`git log` короче на 1), изменения остались staged, сообщение
  «feat: msg» вернулось в input box.

### Sync (фикстура с bare-remote)

- **US-21. Push/Fetch/Pull.** Локальный коммит → «Git: Push» → в bare-remote появился
  коммит (`git -C remote log`). Коммит в remote (через второй клон) → «Git: Fetch» →
  behind вырос; «Git: Pull» → коммит в локальном `git log`.
- **US-22. Push без upstream.** Новая ветка без upstream → «Git: Push». → Предложение
  «Publish branch?»; Confirm → `push -u` прошёл, upstream установлен.
- **US-23. Push rejected.** Remote ушёл вперёд → «Git: Push». → Диалог «…Pull now?»;
  Confirm → pull, затем push можно повторить успешно.
- **US-24. Pull с конфликтом.** Конфликтующие правки локально и в remote → «Git: Pull».
  → Notice о конфликте; конфликтный файл в группе Merge Changes; `gitMerging` активен
  (в «⋯»/палитре доступен «Git: Abort Merge»).

### Branch / Stash / меню

- **US-25. Checkout через пикер.** «Git: Checkout to...» → пикер со спец-пунктами
  (Create new branch... и др.) и ветками → выбрать другую ветку. → `git branch
  --show-current` изменился; список Changes обновился.
- **US-26. Create branch.** «Git: Create Branch...» → ввести имя. → Создана и
  выбрана новая ветка. «Create Branch From...» — то же с выбором base-ref.
- **US-27. Delete branch (not merged).** Ветка с уникальным коммитом → «Git: Delete
  Branch...» → выбрать её. → Диалог «not fully merged … Delete anyway?»; Confirm →
  ветка удалена (`git branch` без неё); Cancel → осталась.
- **US-28. Merge с конфликтом и abort.** «Git: Merge...» → конфликтующая ветка. →
  Конфликт: Merge Changes непуста, `git.mergeAbort` доступен (when `gitMerging`);
  «Git: Abort Merge» → чистое состояние, Merge-группа исчезла.
- **US-29. Stash-цикл.** Правка → «Git: Stash» (с сообщением) → список чист; «Git: Pop
  Stash...» → пикер показывает стэш с сообщением → правка вернулась, стэша нет
  (`git stash list` пуст). «Git: Drop Stash...» — с подтверждением.
- **US-30. Меню «⋯».** Открыть «⋯» секции CHANGES. → Структура согласно разделу
  «Меню»: 1_view/2_git_top/подменю/Show Git Output; подменю раскрываются вложенным
  попапом; в repo без remote нет Pull/Push/Fetch (when); в merge-состоянии в Branch ▸
  есть Abort Merge; у GRAPH-секции меню «⋯» не изменилось (Refresh).

### Устойчивость

- **US-31. Узкий сайдбар.** `resize` до ширины ~25–30 колонок. → Ничего не падает;
  input box и список живы, длинные тексты клипуются.
- **US-32. Ошибка git-операции.** Push на несуществующий/недоступный remote
  (url на несуществующий путь). → Понятный диалог/notice (для auth-класса — подсказка
  про credential helper); stderr доступен в Output; UI сходится к реальному состоянию
  после refresh.

---

## Фазировка

Каждый PR самодостаточен, с тестами колокацией, e2e (функциональный тест и/или
сценарий-демо с PNG per docs/PR.md) и реальным запуском перед «готово» (DoD AGENTS.md).

- [x] **0. Спека** — этот документ + строка в README трекера.
- [x] **1. Группы ресурсов** — протокол `group` в publishChanges, `scmChangeGroups.ts`,
      заголовки-секции в списке, новые id строк, rowMeta. Гейт: US-1; декорации
      файлового дерева не изменились.
- [x] **2. Транспорты мутаций** — `vexx.git.stage/unstage/clean` в расширении: мьютекс,
      валидация uri, envelope, refresh после мутации; интеграционные тесты на temp-репо
      (unborn HEAD, clean tracked/untracked).
- [x] **3. Stage/Unstage + multi-select + меню v2** — `ScmMenuContext v2` (uris+groups),
      `MenuId.ScmResourceGroupContext`, `stagingActions.ts`, `getSelectedChanges()`,
      меню на папках и заголовках групп. Гейт: US-2…9, US-12 (без discard).
- [x] **4. Discard** — `DialogService.confirm()`, `git.clean/cleanAll` с раздельными
      текстами tracked/untracked/mixed. Гейт: US-10, US-11.
- [x] **5. Commit input box** — `InputElement.inspectState` (tuidom), `header` в
      `IViewContainerDescriptor` + VFlex в `attachContainer`, `scmInputComponent.ts`,
      ключ `scmInputFocus`, `workbench.scm.focus`/`scm.action.focusChanges`, персист
      черновика, `input.selectionBackground` в реестр цветов. Гейт: US-13…15.
- [ ] **6. Commit** — диспетчер `vexx.git.op` (первая операция — commit),
      commit-семейство, Ctrl+Enter, `git.undoCommit`. Гейт: US-16…20.
- [ ] **7. Repo-state + меню-инфра** — `vexx.scm.publishRepoState`, `ScmRepoStateService`,
      when-ключи; `ISubmenuContribution.visible`, `gitMenus.ts`, каркас «⋯».
      Гейт: часть US-30 (структура, пустые подменю скрыты).
- [ ] **8. Sync** — pull/push/fetch/sync/publish, `gitOpClient.ts` (диалоги
      auth/rejected/no-upstream/conflict), e2e с bare-remote. Гейт: US-21…24, US-32.
- [ ] **9. Branch** — checkout/create/rename/delete, merge/rebase + abort, ref-пикер
      (`vexx.git.query refs`). Гейт: US-25…28.
- [ ] **10. Stash** — stash-семейство + пикер (`vexx.git.query stashes`). Гейт: US-29.
- [ ] **11. Remote/Tags/прочее** — remote/tag-команды, `git.showOutput`,
      noVerify/commitEmpty/cherryPick. Гейт: US-30 полностью.
- [ ] **12. (Опция) Статус-бар** — `⎇ branch` + ahead/behind, клик → `git.checkout`;
      sync-entry (`git.sync` / Publish).

## Риски

- **Гонки `.git/index.lock`** — фоновый `git status` тоже пишет index; мьютекс мутаций в
  расширении обязателен.
- **Ctrl+Enter в legacy-терминалах** неотличим от Enter — commit доступен из палитры;
  зафиксировать в подсказках.
- **Diff staged-строки** — `openChanges` диффит с HEAD для обеих групп (index↔HEAD и
  worktree↔index не различаются) — осознанное ограничение первой итерации.
- **Stage конфликтного файла** без проверки маркеров конфликта (VS Code спрашивает) —
  упрощение первой итерации.
- **Ошибки без toast-UI** — поверхности только диалог/notice/Output; список сходится
  refresh-ом.
