# Коммиты

Используем Conventional Commits: `type(scope): subject`. Это напрямую влияет на релизный changelog — он собирается из истории через git-cliff (конфиг — `cliff.toml`).

Тип коммита решает, попадёт ли он в changelog. Главное правило: `feat`/`fix`/`perf` — **только** для поведения редактора, видимого пользователю. Любая инфраструктура (изменения в `.github/`, `.vscode/`, workflow-ах, конфигах, билд-скриптах, тестах) идёт под инфраструктурные типы и в changelog не попадает.

**Попадает в changelog (пользовательское):**
- `feat` — новая функциональность редактора
- `fix` — исправление поведения редактора
- `perf` — заметное ускорение
- ломающее изменение — суффикс `!` (`feat!:`, `refactor!:`) или футер `BREAKING CHANGE:` → секция Breaking Changes
- фикс безопасности — упомяни «security» в теле коммита → секция Security

**Скрыто из changelog (инфраструктура/внутреннее):** `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`. Значимый рефакторинг в changelog не показывается — кроме случая, когда он ломающий (`refactor!:`).

`fix` — это исправление **бага в поведении редактора, который замечает пользователь**. Это НЕ:
- правки линта, форматирования, порядка импортов, опечаток в коде → `style`
- починка тестов, конфигов, CI, сборки → `test` / `chore` / `ci` / `build`
- переименования и внутренняя реорганизация без изменения поведения → `refactor`

Формат subject: императив, нижний регистр, без точки в конце. Для `feat`/`fix` subject описывает пользовательский эффект, а не внутреннюю реализацию.

Примеры «было → стало»:
- `feat: enhance test coverage reporting` → `test: enhance coverage reporting` (это про тесты, не про редактор)
- `fix: correct Bash command syntax in settings.json` → `chore: correct Bash command syntax in settings.json` (это конфиг)
- `fix: update nightly release process` → `ci: update nightly release process` (это workflow)
- `fix: correct import order and syntax in various files` → `style: fix import order and lint issues` (это линт/форматирование, а не баг)

**Squash-merge и changelog.** PR вливается squash'ем, и в changelog идёт только заголовок
squash-коммита. PR из `fix(…)` + `refactor(…)` под заголовком `refactor` теряет видимое
изменение (так в #366 правка `getWorkspaceFolder` для расширений не попала в changelog). Видимую
правку выноси отдельным PR — или называй squash по ней (`fix: …`), а не по самому крупному коммиту.
