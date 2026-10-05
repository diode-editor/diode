# Проектные хуки Claude Code

Подключены в [`.claude/settings.json`](../settings.json). Каждый — страховка от граблей, которые уже стоили
сессиям времени; ни один не ходит в сеть, каждый укладывается в ~50–100 мс, и любая собственная поломка
хука (битый JSON, нет git, чужой каталог) означает «пропустить», а не «запретить».

| Хук | Событие | Что ловит |
|---|---|---|
| `bash-guard.mjs` | PreToolUse(Bash) | `npm run test:mutation -- <ref>` — позиционная база молча теряется (npm дописывает её после флагов скрипта); `git fetch <url> …:refs/remotes/…` без `--no-prune` — при `fetch.prune=true` удаляет остальные ref'ы; `git push` на ssh-remote — push только по https с `--force-with-lease=<ref>:<sha>` |
| `edit-guard.mjs` | PreToolUse(Edit\|Write\|NotebookEdit) | сессия в `.claude/worktrees/<имя>`, а правка целится в основной checkout или соседний worktree — подсказывает правильный путь |
| `stop-checklist.mjs` | Stop | мягкий чеклист «готово» по диффу ветки от `origin/main`: линт/типы не запускались в сессии, `feat` без сценария в `e2e/scenarios/`, `vscode.d.ts` без `docs/public/API-COVERAGE.md`. Каждый пункт — один раз (линт — на сессию, остальное — на ветку; состояние в `$(git rev-parse --git-dir)/claude-stop-checklist.json`), на `main` и без диффа молчит |

Отказ PreToolUse — `exit 2` и текст в stderr (он уходит модели). Stop-напоминание приходит модели
продолжением хода (`decision: block`) с явным разрешением закончить, если пункт неприменим; повторный
Stop в том же ходу (`stop_hook_active`) пропускается.

Лизу на тяжёлые прогоны проверяет отдельный глобальный хук (`~/.claude/settings.json`, см. скилл
`heavy-run`), здесь её нет.

Тесты: `node --test .claude/hooks/hooks.test.mjs`.
