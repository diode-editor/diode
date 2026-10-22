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
- Пересборка сайта при изменении контента — `.github/workflows/docs-site.yml`, секрет `DOCS_PAT`
  (fine-grained, только `diode-editor/docs`, Actions: read and write, без срока действия).

## Открыто

- [ ] Контент: человек пересматривает, что на сайте должно быть, — текущие страницы перенесены как есть.
- [ ] Новые страницы: первый запуск и CLI, настройка терминала (truecolor, расширенные клавиши),
      отличия клавиш от VS Code, расширения и курируемый реестр (из README сайта), публикация в реестр.
- [ ] Settings: у ключа нет `scope` и источника (ядро или какое встроенное расширение) — генератор
      каталога их не пишет.
- [ ] Проверить: сводка матрицы API, похоже, расходится с разделами (замечено при переводе): `vscode.workspace` 25/45 против 24/45,
      `vscode.window` 38/57 против 35/57, activation events 6/32 против «7 of 32».
