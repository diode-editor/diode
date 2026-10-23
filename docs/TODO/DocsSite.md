# DocsSite — сайт документации

Цель: с лендинга человек попадает в настоящую документацию — свой сайт с навигацией, поиском и видом
лендинга, а не в просмотрщик GitHub. Пишем только то, чем diode отличается или чего у VS Code нет;
общее (keybindings.json, settings.json, Extension API, tasks.json) — ссылкой на code.visualstudio.com.

Решение человека 2026-10-22: Astro Starlight в отдельном репозитории
[diode-editor/docs](https://github.com/diode-editor/docs), project-pages на
[diode-editor.github.io/docs](https://diode-editor.github.io/docs/) — как магазин. Контент остаётся
здесь, в `docs/public/` (правила — [его README](../public/README.md)), и **по-английски**; шапка — один в
один с лендингом, раскладка — как у доки VS Code (колонка по центру, навигация с поиском, оглавление).

## Сделано

- Каркас сайта: тема на токенах diode Design System, общая с лендингом тема (`localStorage.theme`),
  поиск Pagefind, «Edit page» ведёт в исходник здесь.
- Страницы `docs/public/` переведены на английский; храповик `cyrillic-check` держит их без кириллицы.
- Settings — каталог `settings-schema.generated.ts` с фильтром по ключу, описанию и значению,
  разделами и ссылкой на ключ (`#editor.tabSize`, `?q=`).
- Контент к первому публичному запуску (2026-10-22): новые страницы First run, Keyboard, Terminal setup
  (tmux влит разделом), Extensions; два бенча слиты в Performance (таблица TBD снята); Roadmap ведёт с
  «что работает / чего нет»; матрица API ушла в раздел Extensions «для авторов»; редиректы со старых адресов.
- Ревизия 2026-10-23 «дока для пользователя, а не для автора»: Roadmap → Status (только «чего нет / что
  планируется / чего не будет», без плана выпуска и механики), новая страница Differences from VS Code,
  Install и Performance без устройства каналов и гейтов, матрица API — комментарии в одну-две строки и
  явная семантика счётчика N/M; на сайте — Settings говорит про `.diode/`, описания настроек рендерят
  `` `код` `` и `#key#`-ссылки; лендинг ведёт на страницы сайта, а не на GitHub blob.
- Пересборка сайта при изменении контента — `.github/workflows/docs-site.yml`, секрет `DOCS_PAT`
  (fine-grained, только `diode-editor/docs`, Actions: read and write, без срока действия).

## Открыто

- [ ] Сравнение с vim/neovim/helix одним прогоном — раздел «Other editors» на Performance ждёт цифр
      (задача «честные цифры» из [FirstRelease.md](FirstRelease.md)).
- [ ] Troubleshooting/FAQ — когда накопятся реальные вопросы пользователей.
- [ ] `--help` пишет `--profile <name> (default: "default")`, а профиль Default ищется по имени
      `Default` с учётом регистра: `--profile default` создаст новый профиль. Поправить текст или матчинг.
- [ ] Settings: у ключа нет `scope` и источника (ядро или какое встроенное расширение) — генератор
      каталога их не пишет.
