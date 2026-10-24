# Выпуск версии

Версию выпускают **только по просьбе человека** («выпусти версию», «минорную», «патч», «просто тегни»).
После влития PR сам релиз не делай. Что происходит с релизом дальше (apt, npm, Homebrew, winget, сайт),
описано в [packaging/README.md](../packaging/README.md).

## diode

Версию поднимает workflow [`bump-version.yml`](../.github/workflows/bump-version.yml). Он делает
`npm version <тип>` на `main`, коммитит `chore(release): X.Y.Z` и пушит тег `vX.Y.Z`. Тег запускает
[`release.yml`](../.github/workflows/release.yml): сборку всех платформ, GitHub-релиз и каналы.

```sh
gh run list --branch main --workflow ci.yml --limit 3            # main зелёный? красный — сначала разобраться
gh workflow run bump-version.yml --ref main -f bump_type=patch    # patch | minor | major
gh run list --workflow bump-version.yml --limit 1                 # id прогона
gh run watch <id> --exit-status
gh run list --workflow release.yml --limit 1
gh run watch <id> --exit-status                                   # сборка ~15–20 мин
gh release view vX.Y.Z --json url,assets --jq '.url, (.assets | length)'
```

- Тип по умолчанию — `patch`. `minor` выбирай, только если человек его назвал.
- «Просто тегни» / «просто на main» значит без отдельного PR: bump-коммит идёт прямо в `main`.
- Упала одна job канала в `release.yml` (npm, brew, winget, site) — это не повод выпускать новую
  версию: `gh run rerun <id> --failed`. Каналы независимы, а без секрета job молча пропускается.
- В итоге сообщи номер версии, ссылку на релиз и упавшие каналы, если такие есть.

## tuidom

Публикацию `@tuidom/*` в npm по умолчанию запрашивают у человека (AGENTS.md). Если человек сказал
«публикуй сам», рецепт лежит в `AGENTS.md` репозитория tuidom, раздел «Публикация». Коротко:
`npm run set-version X.Y.Z`, затем PR `release: X.Y.Z`, после мержа тег
`git tag -a vX.Y.Z -m "TUIDom X.Y.Z"` и push тега по https. Workflow `release.yml` tuidom сам сверяет
версию и публикует пакеты через OIDC. После публикации подними `@tuidom/*` в diode отдельным PR.

Версия «приехала», когда `npm view @tuidom/core@X.Y.Z version` отвечает (опрашивай раз в минуту;
20 минут тишины — смотри `gh run list -R tuidom/tuidom`, упавшую job перезапускай, новую версию не
выпускай). В агентском лупе ([scripts/agent-loop/README.md](../scripts/agent-loop/README.md))
реализатор публикует без запроса, и подъём `@tuidom/*` идёт в ветке его задачи — решение человека
2026-10-24.
