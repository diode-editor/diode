# Публичная документация

Исходники страниц сайта документации [diode-editor.github.io/docs](https://diode-editor.github.io/docs/)
(репозиторий сайта — [diode-editor/docs](https://github.com/diode-editor/docs)). В отличие от
остального `docs/` (внутренняя разработческая дока), эти страницы пишутся для пользователя и
**по-английски** — храповик `npm run cyrillic-check` держит их без кириллицы. Этот README — правила
для нас и остаётся по-русски.

Сайт забирает страницы при сборке: пуш в `main`, меняющий `docs/public/` или каталог настроек
(`extensions/diode-settings/settings-schema.generated.ts` — из него страница Settings с поиском),
пересобирает его через `.github/workflows/docs-site.yml`. Первый `# заголовок` страницы становится
её заголовком на сайте, ссылки между страницами — ссылками сайта. **Новая страница** — файл здесь
плюс строка в `PAGES` (`scripts/sync-content.mjs`) и в `sidebar` (`astro.config.mjs`) репозитория
сайта; без неё страница на сайт не попадёт.

Что работает как в VS Code (keybindings.json, settings.json, Extension API, tasks.json), здесь не
пересказываем — ссылаемся на code.visualstudio.com. Пишем то, чем diode отличается или чего у
VS Code нет.

- [INSTALL.md](INSTALL.md) — все каналы установки: quick install, npm, Homebrew, apt, winget, mise, nightly
- [FIRST-RUN.md](FIRST-RUN.md) — первые десять минут: CLI, навигация, выход, где лежат настройки и профили
- [KEYBOARD.md](KEYBOARD.md) — что терминал не доставляет (Ctrl+Shift, Ctrl+Tab, Cmd) и таблица замен `Ctrl+K`, уровни legacy/extended/cmd, Keyboard Doctor
- [TERMINAL.md](TERMINAL.md) — настройка терминала: цвета, расширенные клавиши по эмуляторам, буфер обмена (OSC 52), ssh, tmux (клавиши, буфер, заголовок окна), screen
- [EXTENSIONS.md](EXTENSIONS.md) — магазин и курируемый реестр, установка из редактора и из CLI, `.vsix`, где лежат, что не может работать, публикация в реестр
- [API-COVERAGE.md](API-COVERAGE.md) — матрица готовности API расширений VS Code (для авторов расширений)
- [ROADMAP.md](ROADMAP.md) — статус «альфа»: что работает, чего пока нет, что дальше, чего не будет
- [PERFORMANCE.md](PERFORMANCE.md) — скорость: «наши мс» над полом node, что меряет `bench.yml` (цифры джоб кладёт в ветку `bench-data`, страница `/benchmarks/` рисует их оттуда), лестница старта, сравнение с другими редакторами (запланировано), перф-гейт `npm run test:perf`

Карта сайта (сайдбар — в `astro.config.mjs` репозитория сайта): Getting started — Install, First run,
Keyboard, Terminal setup; Extensions — Installing extensions, API coverage; Reference — Settings;
Project — Roadmap, Performance. Старые адреса (`tmux`, `reference/api-coverage`, `benchmarks`,
`bench-open`) редиректят туда же.

Правила каталога:

- **Цифры и статусы не пишутся руками по памяти.** Бенчи — только снятые по методике из самой
  страницы; матрица выводится из `vscode.d.ts` (активная поверхность = раскомментированные строки)
  и обновляется в том же PR, который меняет поверхность API (правило — в AGENTS.md и
  docs/arch/Extensions.md). Матрица — руками: генератор не заводим. Счётчики `N/M` при
  параллельных PR складываются **дельтами от общей базы** (база 99, соседи +6 и +4 → 109, а не
  «победил последний»), и обе строки таблицы остаются; расхождение сводки с разделом, пришедшее
  из `main`, — чужое, в своём PR его не чинят. Правка корректности уже активного члена счётчик
  не двигает.
- **Потолок называем вслух.** Графа «не будет by design» — обязательная часть матрицы, проигрыш
  голому vim по старту — обязательная часть бенчей.
- Тон — спокойный и проверяемый: каждая цифра воспроизводима, каждый статус выводится из исходников.
