# Что обязано быть в PR

## Демо-сценарий для видимых фич

Любая фича с видимой/внешней составляющей (новый виджет, оверлей, изменение layout, темизации, статус-бара,
дерева файлов и т.п.) обязана принести **сценарий-демо**:

1. Добавь или обнови сценарий в `e2e/scenarios/` (`*.scenario.ts`) — код, который поднимает настоящий
   редактор headless, шлёт нужные команды и снимает кадр(ы). Формат — `defineScenario({ name, open, run })`;
   за образец возьми `e2e/scenarios/quickOpen.scenario.ts`.
2. Прогони `npm run screenshots` — сгенерит PNG в `screenshots/` (каталог в `.gitignore`) +
   `screenshots/INDEX.md`. Посмотри на кадры **сам**: в #194 пропущенный сценарий стоил бага, который
   виден на первом же кадре.
3. В теле PR опиши, что на этих кадрах происходит, и как то же самое пройти руками.

Сценарий — это гейт, а не украшение: он остаётся в репозитории и ловит регрессии дальше.

## Зелёный CI

Прикладывать PNG к телу PR не требуется. Работу принимают по **зелёному CI** (`ci.yml`: типы и линт,
юниты с покрытием, мутационный гейт, e2e на ubuntu и windows) и по **запуску редактора из ветки**: человек
собирает его сам (`npm start` или `npm run build:sea`), а как воспроизвести поведение, ему говорит тело PR.
Бинарников на PR CI не собирает: workflow `PR Build` снят — его артефактами никто не пользовался, а сборку
под все платформы делают `nightly.yml` и `release.yml`. Что сборка не сломана, проверяет e2e: он собирает
SEA-бинарь сам.

Убедись, что все проверки зелёные, прежде чем звать человека принимать: красный CI — это «не готово»,
даже если тесты локально зелёные.

## Если картинку всё-таки хочется приложить

GitHub показывает изображения в теле PR только по URL, а из CLI нельзя залить их в user-content CDN
(это только drag-drop в вебе). Поэтому PNG кладут в **эфемерную orphan-ветку** `pr-assets/<имя-ветки>`
(без общей истории — только блобы картинок) и ссылаются по commit-SHA. Пламбинг ниже **не трогает рабочее
дерево**:

```bash
# из корня репо, после `npm run screenshots`; репо должен быть публичным (иначе camo не отрендерит raw)
E=$(git hash-object -w screenshots/<shot1>.png)
R=$(printf 'Ephemeral screenshot assets for the <branch> PR. Safe to delete after merge.\n' | git hash-object -w --stdin)
T=$(printf '100644 blob %s\t<shot1>.png\n100644 blob %s\tREADME.md\n' "$E" "$R" | git mktree)
C=$(git commit-tree "$T" -m "chore: ephemeral screenshot assets for <branch> PR")   # orphan: без -p
git push origin "$C:refs/heads/pr-assets/<branch>"
# в теле PR ссылайся по SHA (однозначно, без проблем со слэшем в имени ветки):
#   ![editor](https://raw.githubusercontent.com/<owner>/<repo>/$C/<shot1>.png)
```

После мерджа/закрытия PR ветку чистим: `git push origin --delete pr-assets/<branch>`.

Подробности про сценарии и как это гоняется в CI — [TESTING.md](TESTING.md) (раздел «E2E → Скриншот-демо»).

## Стек PR, rebase и push

Сеть — только по https (`origin` в checkout'ах — ssh, а он живёт лишь с проброшенным агентом), перезапись
ветки — только `--force-with-lease` с явным SHA. Руками это легко сделать неправильно, поэтому есть
помощники (`npm run *` разрешён без промптов):

| Команда | Что делает |
|---|---|
| `npm run git:fetch [-- <ветка>…]` | обновляет `origin/main` (и названные ветки) по https с `--no-prune`. Голый `git fetch <url> main:refs/remotes/origin/main` при `fetch.prune=true` **удаляет** остальные `refs/remotes/origin/*` |
| `npm run git:stack-rebase -- <ветка> --base <#PR \| ref> [--dry-run]` | переносит ветку-ребёнка после squash-merge родителя: `git rebase --onto origin/main <голова-родителя> <ветка>`. Squash распознаёт по PR (`gh`: MERGED, merge-коммит уже в `origin/main`) или по patch-id суммарного диффа родителя; не распознал — отказ. Печатает план, ставит тег-страховку `backup/<ветка>/<время>` (backup-ветку rebase уносит, тег — нет) и запоминает SHA ветки на сервере ДО переписывания |
| `npm run git:push [-- <ветка>] [--expect <sha>]` | push по https с `--force-with-lease=refs/heads/<ветка>:<sha>`. SHA — из `--expect`, из записи `git:stack-rebase` или с сервера, если push — fast-forward; иначе отказ. Двигает `origin/<ветка>` локально |
| `npm run git:pr-status [-- <PR \| ветка>]` | `mergeable`, `mergeStateStatus`, сводка проверок и упавшие. `UNKNOWN` переспрашивает с паузой; `CONFLICTING` без проверок — значит **CI не запустится**, пока PR не станет мерджабельным (ждать бесполезно, нужен rebase) |
| `npm run git:wt-bootstrap [-- --force]` | `node_modules` worktree соответствуют `package-lock.json` (sha256 против `node_modules/.lock-hash`), иначе `npm ci`. При подмене движка (`.engine-link/STAMP`) без `--force` отказывается |

Типичный стек после того, как родитель влит squash'ем:

```bash
npm run git:fetch
npm run git:stack-rebase -- my-child --base '#123' --dry-run   # посмотреть план
npm run git:stack-rebase -- my-child --base '#123'
npm run check:diff                                             # если уже есть в ветке
npm run git:push -- my-child
npm run git:pr-status
```
