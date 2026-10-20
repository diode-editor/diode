# demos/ · Stories (`*.stories.ts`) · TestUtils/

Часть архитектуры Diode — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

## demos/
Демо-приложения для ручного тестирования отдельных компонентов (`src/demos/`). Движковые демо-хосты (как напрямую поднимается `TuiApplication` на `NodeTerminalBackend`) уехали в `demos/` репозитория tuidom.

## Stories (`*.stories.ts`)
Интерактивные демо-сценарии виджетов живут **рядом с компонентами** (`*.stories.ts`) и экспортируют именованные функции-стори. Контракт — `src/StoryRunner/StoryTypes.ts` (`StoryContext { app, body, args, afterRun }`, `StoryMeta { title }`).

Контракт story (`StoryContext`/`StoryModule`) приходит из пакета — `@tuidom/testing/storyTypes` (в diode остался шим `src/StoryRunner/StoryTypes.ts`). Истории движковых виджетов уехали вместе с tuidom в [github.com/tuidom/tuidom](https://github.com/tuidom/tuidom); в diode остаются только diode-интеграционные (`src/StoryRunner/stories/`). **Браузер** историй (дерево всех story + Ctrl+K-поиск, аналог веб-Storybook) — отдельный сайд-проект **`tuidom/storybook`**: он ссылается на соседний checkout diode (`../../diode`), сканирует его `src/**/*.stories.ts` и запускает выбранную story; после выноса tuidom его shim нужно переключить на пакет/репозиторий tuidom (не сделано, follow-up). Запуск — из репозитория storybook (`npm run storybook`), при diode рядом на диске.

## TestUtils/
Общие утилиты для тестов (`src/TestUtils/`): харнессы, временные воркспейсы, `expectScreen`, учёт утечек — справочник в [../TESTING.md](../TESTING.md#тестовые-утилиты).

## e2e: кэш сборок

`scripts/e2e-artifacts.mjs` (зовёт `e2e/globalSetup.ts`) собирает бинарь для e2e неизменяемым и кладёт в кэш по хешу; как этим пользоваться в тестах — [../TESTING.md](../TESTING.md#прогон-сборка-воркеры-автоповтор-уборка).

- **Ключ** — sha256 от СОДЕРЖИМОГО входов бинаря: blob-хеш каждого файла рабочей копии (отслеживаемого и нет, кроме игнорируемых) по `src/ extensions/ package*.json tsconfig.json tsup.config.ts scripts/{build,pack}-*.mjs …`, плюс версия node/платформа и `node_modules/.package-lock.json` (его меняют и `npm ci`, и `engine:link`). От состояния git ключ не зависит: коммит/amend/squash с тем же деревом дают ту же сборку. Тесты `*.test.ts` и `e2e/` — не входы.
- **Публикация атомарная:** сборка идёт в `~/.cache/diode-e2e/<key>.tmp-<pid>/`, переезжает `rename` в `<key>/` и становится read-only. Рабочий `dist/` прогон не трогает — раньше `tsup clean` сносил бинарь из-под воркеров (ENOENT/ETXTBSY), а редактор, открытый на репозитории, смотрел на сотни МБ записи в `dist/`. Промах кэша — ~30 с на 4 ядрах.
- **Замок** `<key>.lock` (mkdir + pid владельца, замок мёртвого снимается): два сеанса с одним ключом не собирают его дважды, второй ждёт первого.
- **Хранение:** `DIODE_E2E_CACHE_KEEP` (по умолчанию 3) последних по использованию сборок плюс любая, на которой идёт прогон (`.in-use/<key>@<pid>`). Корень — `DIODE_E2E_CACHE_DIR`; посмотреть — `node scripts/e2e-artifacts.mjs --list`, ключ текущего дерева — `--key`.
- **Версия пиннится в `nightly-e2e`** (если `DIODE_VERSION` не задан): обычная сборка зашивает `nightly-<sha HEAD>`, и любой коммит, даже docs-only, давал бы новый бинарь. Именно не-semver: у сборки без релизной версии проверка `engines.diode` в магазине считается пройденной (`resolveCompatibleVersion.ts`), а semver-заглушка вроде `0.0.0-e2e` её проваливает — и сценарии, ставящие расширение с `engines.diode`, падают.

## tools/drive

`npm run drive -- <команда>` — живой прогон редактора, которым агент водит diode
как браузер: долгоживущая headless-сессия между вызовами CLI. Рецепты и ловушки —
скилл [`.claude/skills/drive/SKILL.md`](../../.claude/skills/drive/SKILL.md); здесь — устройство.

- **Сессия = процесс + запись.** `start` поднимает редактор detached (своя группа
  процессов, stdout/stderr в `<корень>/drive/*.log`) в изолированном корне
  `$TMPDIR/diode-drive-<имя>-*` (раскладка и изоляция HOME/XDG — `prepareAppEnv`
  из `e2e/helpers/appSession.ts`) и пишет запись в `.drive/sessions/<имя>.json`
  этого checkout'а (у каждого worktree свой реестр) и её копию в
  `<корень>/drive/session.json`. Каждый следующий вызов переподключается к порту
  инспектора — сервер держит сколько угодно сокетов, отдельный демон не нужен.
- **Из исходников без обёртки:** `node --import <url tsx> src/vs/diode/main.ts` —
  один процесс (pid записи — сам редактор), абсолютный URL tsx резолвится из
  любого cwd, `reloadWindow` перезапускается с тем же `execArgv`. Перед стартом —
  `scripts/build-extensions.mjs` (быстро, esbuild). `--binary` — `dist/diode`.
- **Готовность** — `Diode.whenReady`: резолвится в тот же момент, что
  `complete: true` трассы старта (`exthost:activated` + фаза `eventually`).
- **Уборка по маркеру.** Все процессы сессии наследуют env
  `DIODE_DRIVE_SESSION=<имя>:<корень>`; `stop`/`gc` находят их по
  `/proc/<pid>/environ` — в том числе ушедших из группы (`setsid` у языковых
  серверов). `gc` сиротой считает процесс, чей лидер (из `session.json` корня)
  мёртв, — поэтому живые сессии соседних worktree он не трогает, а мёртвые
  убирает. Зомби считается мёртвым (init контейнера пожинает не всегда).
- **Методы `Diode.*`** (`src/vs/diode/diodeInspectorMethods.ts`) — сервисы
  портами, регистрация через публичный `InspectorCore.register`; клиент —
  `tools/drive/driveClient.ts`.
