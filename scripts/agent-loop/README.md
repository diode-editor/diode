# Агентский луп: issue → PR без человека в цикле

Эксперимент (2026-10-24): человек ставит задачи в GitHub issues, машина их делает. Одна машина,
диспатчер в tmux, на каждую задачу — своя tmux-сессия с менеджером, реализатором и тестировщиком.
Всё состояние — в GitHub (метки, комментарии), в tmux и в `~/.claude/agent-loop/`; уведомления
человеку — только GitHub. Решение человека: механика «супер тупая» — текстовые правила в скиллах,
точные действия в скриптах, никаких тестов на сам луп, пока не ясно, что он взлетит.

## Запуск на машине

Машина — чистый основной клон на `main` (остальное — worktree), `gh` авторизован, `claude` и
`claude-lease` в PATH, `GH_TOKEN`/auth выставлены **до** старта tmux (сессии наследуют окружение
сервера). Поды пересоздаются — всё ниже руками каждый раз:

```sh
tmux new -s loop                       # первое окно — диспатчер
bash scripts/agent-loop/dispatch.sh    # Enter — тик сейчас, q — выход
```

`dispatch.sh` на старте проверяет `gh auth status`, `claude`, `node`, ёмкость лизы, чистый `main`;
что-то не так — печатает и выходит. Дальше цикл: `git pull --ff-only` → свежая сессия
`claude -p --model $AGENT_LOOP_MODEL --permission-mode bypassPermissions "/dispatch"` → пауза
`AGENT_LOOP_INTERVAL` (600 с). Каждый тик берёт свежий код из `main` — обновления подхватываются
сами. Лог тиков — `~/.claude/agent-loop/dispatch.log`.

Переменные (все необязательны): `AGENT_LOOP_MODEL` (дефолт `opus` — алиас последнего Opus;
зафиксировать версию — `claude-opus-5-5`), `AGENT_LOOP_INTERVAL`, `AGENT_LOOP_HOME`,
`AGENT_LOOP_MAX_TASKS` (3), `AGENT_LOOP_LOAD5_MAX` (nproc/2), `AGENT_LOOP_MEM_MIN_PCT` (30),
`AGENT_LOOP_TASK_TIMEOUT_HOURS` (8), `AGENT_LOOP_MUTATION_BUDGET_MIN` (20).

Посмотреть на задачу глазами — `tmux attach -t task-<N>`: окна `manager`, `implementer`, `tester`.

## Роли

| Роль | Где | Скилл | Делает |
| --- | --- | --- | --- |
| Диспатчер | окно 1 сессии `loop`, одноразовая `claude -p` на тик | [`dispatch`](../../.claude/skills/dispatch/SKILL.md) | сворачивает потерянные/просроченные задачи, чистит worktree, берёт одну issue |
| Менеджер | `task-<N>:manager` | [`task-manager`](../../.claude/skills/task-manager/SKILL.md) | запускает роли, ждёт статусов, при аварии сворачивает задачу |
| Реализатор | `task-<N>:implementer` | [`implementer`](../../.claude/skills/implementer/SKILL.md) | делает задачу в `issue/<N>`, PR, CI, чинит баги, вливает |
| Тестировщик | `task-<N>:tester` | [`tester`](../../.claude/skills/tester/SKILL.md) | use cases по спеке, проверка, баги падающими тестами в `issue/<N>/tests` |

Запуск детей — скилл [`loop-spawn`](../../.claude/skills/loop-spawn/SKILL.md) и `spawn.mjs`
(аналог `tmux-continue`: окно в сессии задачи, модель и `bypassPermissions` форсированы).
Все сессии — на `AGENT_LOOP_MODEL`; `bypassPermissions` потому, что зависание на permission-промпте
хуже любого разрешённого `rm`: под одноразовый. Вопросов человеку никто не задаёт: неясно — `returned`.

## Состояния задачи — метки issue

```
ready to implement ──start-task──▶ in progress ──PR влит (Closes #N)──▶ closed
                                       │
                                       └──return-task──▶ returned  (человек разбирает руками)
```

- Очередь: открытые issues с `ready to implement` без `in progress`/`returned` и без открытых
  блокеров; `bug` первыми, потом старые. Берётся одна задача за тик, если `verdict.canStart`
  (задач меньше 3, load5 < nproc/2, свободной памяти > 30 %).
- Блокеры: нативные зависимости GitHub (`…/issues/<N>/dependencies/blocked_by`) и строка
  `Blocked by #A, #B` в теле issue. Пока хотя бы один блокер открыт, задача лежит в `blocked`;
  закрылся — попадает в очередь сама. Так ставится цепочка из 3–5 последовательных задач.
  Спеку и цепочку готовит человек со скиллом [`spec`](../../.claude/skills/spec/SKILL.md).
- Захват: комментарий `claim: <host> <ISO>` + `session: task-<N>`; перечитать — чужой более
  ранний claim выигрывает (два пода). Время claim'а — начало отсчёта таймаута задачи.
- Ветка `issue/<N>` уже на origin — задача не берётся, ставится `returned` с объяснением:
  луп стартует только с нуля, автовозобновления нет.
- `returned`: комментарий с причиной и хвостами всех панелей (`<details>` по окнам), PR в draft,
  сессия убита, worktree снесёт уборка. Человек отвечает в issue, прибирает ветку и снова
  ставит `ready to implement`.

## Контракт ролей — статус-файлы

`~/.claude/agent-loop/tasks/<N>/`, запись атомарная (`status.mjs`), чтение — `wait.mjs`:

| Файл | Кто пишет | `status` | Поля |
| --- | --- | --- | --- |
| `implementer.json` | реализатор | `ready-for-test` → `done` / `returned` | `pr`, `branch`, `note` (решения по спеке), `question` |
| `tester.json` | тестировщик | `approve` / `bugs` / `returned` | `branch`, `bugs: [{title, test, note}]`, `question` |
| `mutation-budget.json` | `mutation-budget.mjs` | — | `usedSeconds`, `runs` |
| `test-plan.md` | тестировщик | — | use cases до проверки |
| `<роль>-prompt.md` | `spawn.mjs` | — | промпт окна |

Ход: реализатор пишет `ready-for-test` **сразу после создания PR** (CI ещё бежит) → менеджер
запускает тестировщика (с `note` реализатора) → тестировщик пишет `approve`/`bugs` → реализатор
сам ждёт `tester.json`, забирает `origin/issue/<N>/tests`, чинит, доводит CI, вливает, пишет `done`
→ менеджер убивает сессию. Без вердикта тестировщика влития нет. Второго прохода нет.

`wait.mjs` блокируется до первого события: `status` (0), `window-gone` (10), `idle` (11 — панель не
меняется 15 мин **и** у claude окна нет выполняемой команды; ждущие `claude-lease`, `gh … --watch`
и сам `wait.mjs` — выполняемые команды, они не idle), `timeout` (12). Таймауты: реализатор 4 ч,
тестировщик 2 ч, фикс багов 2 ч, задача целиком 8 ч (её считает диспатчер — на случай смерти
менеджера).

## Бюджет мутаций

Мутационный гейт полезен (дизайн, качество) и дорог. У реализатора **20 минут прогонов на задачу**;
считается только время под слотом лизы, ожидание слота — нет:

```sh
claude-lease run -- node scripts/agent-loop/mutation-budget.mjs -- npm run test:mutation [-- --mutate src/x.ts]
```

Исчерпан — код 76, дальше только CI (`npm run ci:run -- mutation`); начатый прогон не обрывается.
Прямой `test:mutation`/`stryker`/`mutation-diff.mjs` при `AGENT_LOOP_TASK` в окружении режет
`.claude/hooks/bash-guard.mjs`; `--scope-only` бесплатен. Храповик не опускаем: PR всё равно должен
пройти mutation-job в CI. Давление на реализатора — в скилле: тест до/вместе с кодом, первый
прогон только после зелёного `check:diff`, мутантов проверять точечно `--mutate`.

## Нагрузка

Тяжёлое сериализует лиза (`машина=1`, `.claude/leases.json`), `npm test` в манифест не добавлен,
но детям велено гонять его под лизой всегда. Медленность и таймауты на загруженной машине —
повтор под лизой, не расследование. Пороги старта новой задачи — в `facts.mjs` через переменные
выше; человек наблюдает и подкручивает.

## Уборка

Каждый тик `cleanup-worktrees.mjs`: worktree в `.claude/worktrees/` с веткой, влитой в
`origin/main`, и без живого процесса с cwd внутри — сносится (чьи угодно, незакоммиченное не
спасается); `git worktree prune`; влитые локальные `issue/*`; на origin — `issue/<N>/tests`
влитых задач. Не влито или занято — лежит.

## Скрипты

| Скрипт | Зачем |
| --- | --- |
| `dispatch.sh` | внешний цикл: pull → `/dispatch` → пауза; Enter/q |
| `facts.mjs` | JSON фактов для тика: машина, лимиты, вердикт, сессии, in progress, очередь, worktree |
| `start-task.mjs --issue N` | claim, метки, каталог задачи, `tmux new-session task-N` с менеджером |
| `return-task.mjs --task N --reason …` | комментарий с хвостами панелей, PR → draft, `returned`, kill-session |
| `spawn.mjs --task N --role R [--note f]` | окно роли в сессии задачи |
| `wait.mjs --task N --role R [--expect S] [--timeout] [--idle]` | ждать статус/аварию роли |
| `status.mjs write\|read --task N --role R …` | статус-файлы |
| `mutation-budget.mjs -- <cmd>` | бюджет мутационных прогонов |
| `cleanup-worktrees.mjs [--dry-run]` | уборка влитого |
| `lib.mjs` | общее: пути, tmux, процессы, worktree |

Скрипты — по-английски (храповик `cyrillic-check`), тексты в issues — по-русски (их пишут
LLM-роли и передают скриптам как есть), PR и код — по-английски.
