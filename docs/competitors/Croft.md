# Croft (vitali87/croft) — разбор конкурента

Срез на 2026-11-18, HEAD `main` 5f41876a (v0.2.132). Источники: клон репозитория (только чтение,
`--depth 200`), `gh` (метаданные, релизы, контрибьюторы), HN Algolia, веб-поиск. Reddit не
смотрели (закрыт для автоматики). Узнали о нём из комментария в треде нашего первого поста в
r/tui. Разбор TTT — [TTT.md](TTT.md), выводы для выхода — [MARKETING.md](../MARKETING.md).

## Паспорт

- **Что:** «A VS Code style three pane workspace that runs entirely inside your terminal». Rust,
  MIT, сайт [docs.croft.software](https://docs.croft.software). Цель в README: «A complete VS Code
  replacement in the terminal… Everything VS Code does, croft will do».
- **Автор:** Vitali Avagyan (Лондон), соло: ~6000 коммитов с его аккаунта, ~1380 — с аккаунта
  `claude`, сторонних — единицы. Основной дом заявлен на Codeberg, GitHub — зеркало.
- **Возраст:** репозиторий с 2026-07-28 — **меньше четырёх месяцев**. Версии v0.1.697 (07.08) →
  v0.2.132 (09.11), номер патча — счётчик сборок.
- **Объём:** ~550 тыс. строк Rust вместе с тестами, ~271 тыс. production-строк в одном крейте
  (их собственный замер в `docs/EXTENSIONS.md`: релизная сборка 14 минут, «код туго завязан»).
  Бинарь ~63 МБ, треть — 25 грамматик tree-sitter.
- **Процесс — агентный и не скрывается:** ~1300 из ~5500 коммитов с `Co-Authored-By`, README
  написан в узнаваемом стиле «Tenets… non-negotiables». AGENTS.md и `.claude/` в репозитории нет.
- **Тракшн:** 107 звёзд, 10 форков, 281 открытая issue. Show HN не было; на HN — одна ссылка
  через Terminal Trove (08.11, 6 очков). Пресса: [LinuxLinks](https://www.linuxlinks.com/croft-vs-code-inspired-terminal-user-interface-text-editor/),
  [Terminal Trove](https://terminaltrove.com/croft/), пара агрегаторов. It's FOSS — нет.

## Что у них есть (по README и коду)

- **Оболочка один в один VS Code:** activity bar, Explorer, Search, Source Control, Remote (SSH),
  Run and Debug, Extensions, Testing; панель PROBLEMS / OUTPUT / TERMINAL / PORTS; Customize
  Layout; иконки — Nerd Font (без него `[?]`).
- **LSP:** completion, hover, переходы, rename, quick fixes, inlay hints. Серверы **ставит сам**
  (`provision = { kind = "uv", … }`, vtsls через npm): Python — ty + basedpyright + ruff, плюс
  TS, Rust, Go, C++, CSS, HTML, JSON, YAML, Bash, Lua, Markdown, TOML. Подсветка — tree-sitter.
- **Отладка по DAP:** Python, JS/TS, Rust, C/C++ (LLDB), Go — встроенными манифестами.
- **Remote:** `croft remote <host>` ставит себя на сервер при первом подключении (статический
  musl-бинарь), `croft devcontainer`. Принцип «local and remote parity».
- **Агенты:** `croft hook install` регистрирует croft как **PreToolUse-хук Claude Code** на правки
  файлов: Edit/Write/MultiEdit агента показываются диффом в croft и одобряются или отклоняются
  до записи (`src/agent_approval.rs`, `src/agent_hook.rs`). Ещё `croft pair` — AI-навигатор, в
  том числе на локальных моделях; MCP-гость в сессии.
- **Совместная работа:** `croft attach` — сессия живёт после закрытия окна, к ней можно
  подключиться, `--solo` — независимые вьюпорты.
- **Прочее, широко:** тест-эксплорер (cargo, go, jest, pytest, vitest), vim-режим, мультикурсор,
  миникарта, blame, граф коммитов, превью картинок/PDF/таблиц (Kitty, iTerm2, sixel), просмотр
  архивов и SQLite, CodeQL, Live Run для Python, импорт настроек, клавиш и сниппетов VS Code
  (`src/import_vscode.rs`, несовпадающие ключи перечисляет, а не молча теряет).
- **Платформы:** macOS, Linux (статический musl, x64 и arm64), Android (Termux), Windows только
  через WSL2. Установка: brew, `cargo binstall`, архив с подписью sigstore.

## Расширения — главное отличие от нас

**Расширения VS Code Croft не запускает и запускать не собирается.** Их «расширение» — свой
манифест `extension.toml` (декларативный: команда языкового сервера, отладчика, MCP-сервера) из
собственного подписанного индекса (ed25519). 27 встроенных манифестов. План в
`docs/EXTENSIONS.md` — внешние программы по stdin/stdout, нативные плагины и WASM отвергнуты.

Из Open VSX и магазина VS Code Croft берёт **только темы**: качает `.vsix`, вынимает
`contributes.themes` и конвертирует. В ARCHITECTURE.md прямо: «A `.vsix` is treated as a hostile
container… no extension code is fetched to be run». То есть наш тезис «настоящие расширения
VS Code из магазина как есть» Croft не перекрывает — это осознанно противоположный выбор.

## Где они сильнее нас

- **Отладка на пяти языках** и тест-эксплорер — уже в README, без оговорок. У нас отладка
  только появилась (CodeLLDB, ноябрь), и адаптеры — расширения из магазина, а не встроенные.
- **Remote, который ставит себя сам** (`croft remote host`) — удобнее, чем «поставь бинарь на
  сервер». И статический musl — работает на Alpine и старых glibc.
- **Превью Claude Code до применения правки — есть.** Это бьёт по заголовку, который мы готовили
  для r/ClaudeCode («Claude Code присылает правки в редактор до применения, а TTT смотрит
  постфактум»). У Croft — через хук, у нас — через стоковое расширение Claude Code, но для
  читателя это одна и та же функция.
- **Ширина:** коллаборация, CodeQL, Live Run, превью документов — набор фич больше нашего.
- **Нативная скорость и размер:** Rust, 63 МБ против наших ~150–200 МБ.

## Где сильнее мы

- **Экосистема даром:** любое языковое расширение VS Code (Java с JRE внутри, JBang, Angular,
  Tailwind) — без отдельного манифеста под каждый язык. У Croft каждый язык — их работа.
- **Точность VS Code:** `settings.json` и `keybindings.json` как есть, а не импорт через таблицу
  соответствий с потерями; дословный перенос PieceTree, diff, токенизации.
- **Дисциплина качества как аргумент:** мутационный гейт, перф-гейты в CI, стоковые расширения в
  тестах. У Croft сами пишут, что код «туго завязан» в один крейт на 271 тыс. строк.
- **Windows** — у нас есть через npm, у них только WSL2.

## Выводы для нас

1. **Позиционирование не меняется, а укрепляется.** Три соседа (TTT, Fresh, Croft) — каждый «VS Code
   в терминале» со своей системой плагинов. Расширения VS Code из магазина запускаем только мы,
   и Croft отказался от этого принципиально. Заголовки — про это.
2. **Пост в r/ClaudeCode — не на «превью правок».** У Croft эта функция есть и описана в README.
   Наш угол там: редактор рядом с агентом, в котором работают расширения VS Code (тот же Claude
   Code — стоковым расширением), а не уникальность превью.
3. **Заготовленный ответ «Have you seen Croft?»** — тот же, что для TTT и Fresh: да, хороший
   проект; у них своя система расширений и темы из VS Code, мы запускаем сами расширения.
4. **Подсмотреть:** `croft remote <host>` с самоустановкой на сервер; импорт профиля VS Code с
   явным списком непереносимого; встроенный список «языковые серверы ставятся сами» как
   ориентир, что пользователи ждут из коробки.
