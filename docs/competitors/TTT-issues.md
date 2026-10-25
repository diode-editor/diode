# TTT Editor (eugenioenko/ttt): разбор issue-трекера

Дата среза: 2026-10-25. Источник — выгрузка `gh issue list` / `gh pr list` / GraphQL discussions репозитория eugenioenko/ttt (374 issue с комментариями и реакциями, 4 треда, 734 PR); сырые JSON в репозиторий не кладём. Общий разбор проекта — [TTT.md](TTT.md).
Справка о проекте: TTT написан на Go (tcell v3, свой порт vscode-textmate, Lua-плагины). Позиционирует себя как «VS Code/Zed/Sublime-like editor в терминале». Первые issue появились в конце мая 2026, первые внешние — 21 июня 2026. Релизы выходят раз в две недели (1.0.0 — июль, 1.9 — октябрь).

## 0. Главное о данных

- **374 issue: 331 закрыта, 43 открыты.** **298 (80%) завёл сам мейнтейнер** eugenioenko: это его бэклог, задачи для агентов, follow-up'ы ревью и «good first issue» для контрибьюторов. **76 issue от других авторов**: 73 от 40 людей и 3 от бота CodeRabbit.
- Из 73 внешних issue примерно 25 пишут **активные контрибьюторы, работающие с агентами**. Это arimxyer (8 issue и 33 PR), aahoughton (8 и 15; сам пишет «I (well, Claude) found»), SimonOcampo1, sercanatalik, risixdzn. Они приносят предложения API и dev-задачи с готовым PR, а не жалобы. **Голос рядовых пользователей** — около 45 issue примерно от 30 человек.
- **Вовлечённость почти нулевая.** Максимум реакций на одной issue — 2 (#460), ни одна фича не собрала голосов. Поэтому ранжирую по числу комментариев, по повторяемости темы у разных людей и по тому, взял ли мейнтейнер её в работу. Самые обсуждаемые: #423 (21 комментарий, рант про хоткеи/Emacs), #386 (Vim, 10), #443 (CJK, 7), #285 (root и дефолтный workspace, 6), #761/#467/#695/#812/#904 (по 5).
- Внешние issue по типам: фичи — 30, баги — 29, dev/CI/тесты — 6, вопросы — 3, бот — 3, прочее (мета, трекер, инфра, UX, платформа) — 5. Состояние: 60 закрыто, 16 открыто.
- Мейнтейнер отвечает очень быстро, часто в тот же день («fixed in next release»). Пользовательские баги обычно закрываются за 0–3 дня. Внешние PR принимают охотно: **217 внешних PR, из них 176 влиты**.
- Discussions почти пустые: 4 треда по 1 upvote (см. §7).

## 1. Полная таблица внешних issue (76 = 73 от людей + 3 от CodeRabbit)

Колонка 👍/💬 — суммарные реакции и число комментариев.

| # | Заголовок | Автор | Дата | Тип | Область | Статус | 👍/💬 | Суть |
|---|---|---|---|---|---|---|---|---|
| [#223](https://github.com/eugenioenko/ttt/issues/223) | Remove folder from workspace? | jetpax | 2026-06-21 | вопрос/фича | workspace | CLOSED: исправлено | 0/4 | Удаление папки из multi-root workspace неочевидно; по итогам добавлены Remove Folder в dropdown и Copy Path (abs/rel) |
| [#244](https://github.com/eugenioenko/ttt/issues/244) | Cant scroll large file list in explorer using iterm2 | jetpax | 2026-06-22 | баг | платформа: macOS/iTerm2, explorer | CLOSED: исправлено | 0/2 | В iTerm2/Ghostty не видно скроллбара explorer, большой список не скроллится без фокуса |
| [#245](https://github.com/eugenioenko/ttt/issues/245) | add new folder has incorrect path construction | jetpax | 2026-06-22 | баг | explorer/FS | CLOSED: исправлено | 0/0 | New Folder: путь с ~ собирается неправильно |
| [#246](https://github.com/eugenioenko/ttt/issues/246) | Cant copy text using cmd-C in iterm2/MacOS | jetpax | 2026-06-22 | баг | платформа: macOS, clipboard/keybindings | CLOSED: частично (ограничение терминала) | 0/4 | Cmd+C/Cmd+V в iTerm2 не копирует; Cmd перехватывается терминалом; Cmd+V через bracketed paste починен |
| [#247](https://github.com/eugenioenko/ttt/issues/247) | Mouse support not working in MacOS Terminal | jetpax | 2026-06-22 | баг | платформа: macOS Terminal.app, mouse | CLOSED: не баг (окружение) | 0/2 | Мышь не работает в Terminal.app — оказалось проблема системы пользователя |
| [#263](https://github.com/eugenioenko/ttt/issues/263) | CTRL-F does not set focus to search panel when panel is already opened | egorse | 2026-06-26 | баг | поиск/фокус | CLOSED: исправлено | 1/1 | Ctrl+F при уже открытой панели поиска не возвращает в неё фокус |
| [#266](https://github.com/eugenioenko/ttt/issues/266) | Add NixOS support / upstream flake.nix | pirate-boop | 2026-06-26 | фича | упаковка: Nix | CLOSED: исправлено | 1/2 | Добавить flake.nix для NixOS |
| [#281](https://github.com/eugenioenko/ttt/issues/281) | Cursor rendering offset / desync with Cyrillic (UTF-8) characters | pirate-boop | 2026-06-28 | баг | i18n/unicode (кириллица) | CLOSED: исправлено | 1/2 | Курсор уезжает при наборе кириллицы: позиции считались в байтах, а не в рунах |
| [#284](https://github.com/eugenioenko/ttt/issues/284) | Feat: UX/UI Improvements (State Sync, Auto-save with Local History, and TUI Settings) | pirate-boop | 2026-06-29 | фича (пакет) | UX: rename→tabs, autosave, local history, TUI settings, pin tabs | CLOSED: частично; autosave/history вынесены в #577 | 0/4 | Rename в explorer не обновляет открытые табы; хотят автосейв с debounce + локальную историю, GUI-настройки, pin tabs, '+' для нового таба |
| [#285](https://github.com/eugenioenko/ttt/issues/285) | Feat: "Advanced Mode" to explore system directories (Root space support) | pirate-boop | 2026-06-29 | фича | workspace/explorer | OPEN: открыто | 0/6 | 'Advanced mode' — открыть / (root); по итогам: дефолтный список папок в settings / default workspace |
| [#335](https://github.com/eugenioenko/ttt/issues/335) | Automate vendorHash updates on Go dependency changes | pirate-boop | 2026-07-05 | инфра | упаковка: Nix CI | CLOSED: исправлено | 0/3 | Автообновление vendorHash во flake через GitHub Action |
| [#386](https://github.com/eugenioenko/ttt/issues/386) | adding vim shortcuts | atreus44 | 2026-07-19 | фича | keybindings: Vim | CLOSED: исправлено (плагин ttt-vim) | 0/10 | Vim-режим (hjkl, gg/G, motions, modal). Реализован как плагин, расширили Plugin API |
| [#397](https://github.com/eugenioenko/ttt/issues/397) | Under Windows, all keystrokes are duplicated | z-hunter | 2026-07-20 | баг | платформа: Windows, ввод | CLOSED: исправлено (миграция tcell v2→v3) | 0/3 | На Windows каждый символ вводится дважды |
| [#411](https://github.com/eugenioenko/ttt/issues/411) | Windows: Terminal not supported | z-hunter | 2026-07-21 | баг/фича | платформа: Windows, терминал | CLOSED: исправлено | 0/2 | Встроенный терминал не поддерживался на Windows (creack/pty без ConPTY) |
| [#412](https://github.com/eugenioenko/ttt/issues/412) | Add "Reveal in File Manager" | LeTuR | 2026-07-22 | фича | explorer/OS-интеграция | CLOSED: исправлено | 0/1 | Reveal in File Manager в контекстном меню |
| [#417](https://github.com/eugenioenko/ttt/issues/417) | Move pr.review out of the File menu — the only Git command living there | aaronsb | 2026-07-23 | UX | меню/git | CLOSED: закрыто (обсуждение) | 0/2 | Review PR лежит в меню File; предложили отдельное меню Source Control |
| [#423](https://github.com/eugenioenko/ttt/issues/423) | Unfortunately, no matter how good yet another good code editor might be ... | forthrin | 2026-07-29 | мета/фича | keybindings: Emacs, философия UI | CLOSED: исправлено (плагин emacs) + #567 | 0/21 | Рант про мышечную память; итог: emacs-плагин, отключение номеров строк, не мигающий курсор, критика меню/F-клавиш, идея логгера хоткеев |
| [#434](https://github.com/eugenioenko/ttt/issues/434) | Fullwidth CJK text renders only every other character (e.g. Korean `가나다라마바사` shows as `가다마 | rishubil | 2026-08-03 | баг | i18n/unicode (CJK fullwidth) | CLOSED: исправлено | 0/1 | Fullwidth CJK: каждый второй символ не рисуется |
| [#443](https://github.com/eugenioenko/ttt/issues/443) | BUG: render for chinese text,missing some char | lozzo | 2026-08-08 | баг | i18n/unicode (китайский) | CLOSED: не воспроизведено | 0/7 | Пропуск символов в китайском markdown; после фикса #434 — новая артефакт-проблема, затем исчезла |
| [#446](https://github.com/eugenioenko/ttt/issues/446) | [Question] How to switch the python interpreter used for LSP | leandrocm86 | 2026-08-18 | вопрос | LSP: Python venv | CLOSED: отвечено (workaround) | 0/2 | Как запустить pyright из нужного venv — только через wrapper-скрипт |
| [#460](https://github.com/eugenioenko/ttt/issues/460) | Status bar goes stale after a tab switch made by an --exec script command | arimxyer | 2026-08-20 | баг | status bar / --exec автоматизация | CLOSED: исправлено (PR автора) | 2/1 | Статус-бар не обновляется после переключения таба из --exec скрипта |
| [#467](https://github.com/eugenioenko/ttt/issues/467) | The Quick Open feature isn’t working as expected. | vikas-0 | 2026-08-21 | баг | Quick Open | CLOSED: исправлено | 0/5 | Quick Open не находит файлы (лимит 10k walkDir); перешли на rg --files → git ls-files → walkDir 100k |
| [#483](https://github.com/eugenioenko/ttt/issues/483) | Add translations for various languages | anderlli0053 | 2026-08-22 | фича | i18n UI (локализация) | OPEN: открыто, на роадмапе | 0/1 | Переводы интерфейса (предложение помочь со словенским) |
| [#492](https://github.com/eugenioenko/ttt/issues/492) | ci: align setup-go version with go.mod | arimxyer | 2026-08-22 | dev/CI | CI | CLOSED: исправлено | 0/0 | Версия setup-go не совпадает с go.mod |
| [#493](https://github.com/eugenioenko/ttt/issues/493) | feat(git): add keyboard navigation for commit-detail disclosures | arimxyer | 2026-08-22 | фича/a11y | git: commit detail, клавиатура | CLOSED: исправлено | 0/1 | Клавиатурная навигация по раскрывашкам в commit detail |
| [#495](https://github.com/eugenioenko/ttt/issues/495) | refactor(term): reconcile tcell event ownership with the documented layer boundary | arimxyer | 2026-08-22 | dev/архитектура | внутреннее | CLOSED: закрыто решением | 0/1 | Граница владения событиями tcell — решено оставить и задокументировать |
| [#524](https://github.com/eugenioenko/ttt/issues/524) | fix(git): bound repository path identity retries during filesystem churn | arimxyer | 2026-08-23 | dev/баг | git: identity resolution | CLOSED: исправлено | 0/0 | Неограниченные ретраи при резолве пути репозитория |
| [#525](https://github.com/eugenioenko/ttt/issues/525) | perf(git): coalesce active repository identity refreshes during watcher bursts | arimxyer | 2026-08-23 | dev/perf | git: watcher | CLOSED: исправлено | 0/0 | Схлопывать refresh identity при всплесках watcher-событий |
| [#533](https://github.com/eugenioenko/ttt/issues/533) | test(terminal): replace racy mouse-forwarding PTY readiness fixture | arimxyer | 2026-08-23 | dev/тесты | терминал: тесты mouse forwarding | OPEN: открыто | 0/0 | Гонка в фикстуре PTY-тестов |
| [#534](https://github.com/eugenioenko/ttt/issues/534) | UX follow-ups: authoring, navigation, and presentation | arimxyer | 2026-08-23 | трекер | git UX: commit composer, навигация | CLOSED: перенесено в приватный проект | 0/1 | Индекс UX-идей: многострочный редактор commit message и пр. |
| [#572](https://github.com/eugenioenko/ttt/issues/572) | feat: column operations | lecheel | 2026-08-30 | фича | editor: column/block selection | CLOSED: отклонено ('multicursor хватает') | 0/1 | Классические колонковые операции (визуальный блок, I/A/c) |
| [#592](https://github.com/eugenioenko/ttt/issues/592) | Any plan to support tgrep | vikas-0 | 2026-09-07 | фича | поиск: tgrep | CLOSED: закрыто без ответа | 0/0 | Поддержка tgrep вместо ripgrep для монолитов |
| [#594](https://github.com/eugenioenko/ttt/issues/594) | Herdr plugin: pane process cwd stays at plugin root, re-rooting herdr workspace onto the p | JohnWJ-co | 2026-09-09 | баг | интеграция: herdr (мультиплексор) | CLOSED: исправлено | 0/1 | Плагин herdr: cwd процесса остаётся корнем плагина |
| [#595](https://github.com/eugenioenko/ttt/issues/595) | herdr plugin: 'Open TTT' action panics with 'open /dev/tty: device not configured' | hassanabdulqayyum | 2026-09-09 | баг | интеграция: herdr | CLOSED: исправлено | 0/1 | Action 'Open TTT' падает с open /dev/tty (нет TTY) |
| [#657](https://github.com/eugenioenko/ttt/issues/657) | Proposal: welcome page, Clone Repository and opt-in desktop launcher | SimonOcampo1 | 2026-09-24 | фича | welcome page, clone repo, desktop launcher | CLOSED: исправлено (PR автора) | 1/2 | Стартовая страница при запуске из $HOME, Clone Repository, .desktop-ярлык |
| [#662](https://github.com/eugenioenko/ttt/issues/662) | Drag a file or folder from the Explorer onto the terminal to insert its path | SimonOcampo1 | 2026-09-25 | фича | explorer→terminal DnD | OPEN: открыто (PR есть) | 0/0 | Перетащить файл из explorer в терминал, чтобы вставить путь (для агентов в терминале) |
| [#670](https://github.com/eugenioenko/ttt/issues/670) | Highlighting gets lost when a tag's attributes span multiple lines (HTML, Angular, JSX/TSX | michalekmatej | 2026-09-25 | баг | подсветка синтаксиса (HTML/JSX/TSX) | CLOSED: исправлено (переход на TextMate) | 0/4 | Подсветка теряется, если атрибуты тега на нескольких строках; перешли с построчного chroma на порт vscode-textmate |
| [#671](https://github.com/eugenioenko/ttt/issues/671) | feat: mark git changes on the editor scrollbar | risixdzn | 2026-09-25 | фича | git: метки на скроллбаре | CLOSED: исправлено (PR автора) | 0/3 | Метки git-изменений на вертикальном скроллбаре, как в VS Code |
| [#672](https://github.com/eugenioenko/ttt/issues/672) | fix(git): git gutter diff uses quadratic memory on large files | risixdzn | 2026-09-25 | баг/perf | git gutter: память | CLOSED: исправлено | 0/0 | LCS-дифф gutter жрёт O(n·m) памяти: 20k строк → 3.2 ГБ → OOM |
| [#686](https://github.com/eugenioenko/ttt/issues/686) | test: TestCachedHighlightStyleFollowsLiveStyleMap flakes under -race (per-line time budget | SimonOcampo1 | 2026-09-29 | dev/тесты | подсветка: flaky test | CLOSED: исправлено | 0/1 | Флак теста из-за 50ms бюджета на строку (компиляция грамматики) |
| [#695](https://github.com/eugenioenko/ttt/issues/695) | Ttt doesn't work on Termux. | micuit-cuit | 2026-09-30 | платформа | Android/Termux | CLOSED: workaround (сборка из исходников) | 0/5 | Бинарь linux-arm64 не работает в Termux; позже добавили android-arm64 сборку |
| [#697](https://github.com/eugenioenko/ttt/issues/697) | Files cannot be edited in diff view | antonantal | 2026-10-02 | фича | diff: редактирование | CLOSED: исправлено | 1/3 | Редактировать файл прямо в diff-view как в VS Code |
| [#706](https://github.com/eugenioenko/ttt/issues/706) | Feature request: split editor (view two files side by side) | micuit-cuit | 2026-10-06 | фича | layout: split editor | OPEN: открыто, мейнтейнер против | 0/1 | Сплит редактора; мейнтейнер: 'сплит — фича терминала/tmux' |
| [#729](https://github.com/eugenioenko/ttt/issues/729) | Show favorite folders in the Open/Add Folder picker | SimonOcampo1 | 2026-10-07 | фича | folder picker: избранное | OPEN: открыто | 1/1 | Избранные папки в диалоге Open/Add Folder |
| [#742](https://github.com/eugenioenko/ttt/issues/742) | feat(explorer): reveal the active file in the explorer | mshafir | 2026-10-08 | фича | explorer: reveal active file | CLOSED: исправлено (PR автора) | 1/1 | Reveal Active File in Explorer + explorer.autoReveal |
| [#755](https://github.com/eugenioenko/ttt/issues/755) | Toggle hidden files | xircon | 2026-10-09 | вопрос | explorer: скрытые файлы | CLOSED: отвечено | 0/1 | Как показать скрытые файлы — через Settings |
| [#760](https://github.com/eugenioenko/ttt/issues/760) | Support for AI inline suggestion | hazymoon22 | 2026-10-10 | фича | AI: inline suggestions (Copilot) | OPEN: открыто, help wanted | 0/2 | Inline-подсказки ИИ (ghost text, Tab, по слову) — через copilot-language-server |
| [#761](https://github.com/eugenioenko/ttt/issues/761) | Support TypeScript 7's native language server (tsc --lsp --stdio) | aahoughton | 2026-10-10 | баг/фича | LSP: TS7 tsc --lsp | CLOSED: исправлено (PR автора) | 0/5 | LSP-клиент не принимал строковые id и server→client запросы; pull diagnostics |
| [#812](https://github.com/eugenioenko/ttt/issues/812) | Feature request: Shebang-based syntax highlighting for extensionless scripts | rafjaf | 2026-10-11 | фича | подсветка: shebang | CLOSED: исправлено (PR автора) | 1/4 | Определять язык по shebang для файлов без расширения |
| [#813](https://github.com/eugenioenko/ttt/issues/813) | feat(plugin): let plugins present binary file types and draw images | sercanatalik | 2026-10-11 | фича | плагины: file handlers + изображения | CLOSED: исправлено (PR автора) | 0/3 | API плагинов для бинарных форматов (PDF-просмотрщик) и рисования картинок (Kitty graphics) |
| [#883](https://github.com/eugenioenko/ttt/issues/883) | [Rocky Linux] Mouse codes dumped to the terminal when exiting | gondsman | 2026-10-13 | баг | платформа: Rocky Linux, mouse | OPEN: открыто (воспроизведено) | 0/4 | При выходе мышью в шелл вываливаются коды мыши; down/up с 0ms — фикс: действие на mouse-up |
| [#899](https://github.com/eugenioenko/ttt/issues/899) | Search (file.quickOpen) is not listing all files. | MattOrmianek | 2026-10-14 | баг/фича | Quick Open: скрытые/ignored | OPEN: открыто | 0/1 | Quick Open показывает не все файлы; нужна настройка showHidden/showGitIgnored |
| [#904](https://github.com/eugenioenko/ttt/issues/904) | feat(theme): follow the active Omarchy theme | danielmrdev | 2026-10-14 | фича | темы: Omarchy | CLOSED: исправлено (как плагин) | 0/5 | Тема, следующая за палитрой Omarchy; сделали плагином + расширили fs-permissions |
| [#933](https://github.com/eugenioenko/ttt/issues/933) | LSP cannot be started due to jsonrpc error | lien-hung | 2026-10-16 | баг | платформа: Windows, LSP URI | CLOSED: исправлено | 1/3 | LSP не стартует на Windows: кривой file:// URI с обратными слэшами |
| [#952](https://github.com/eugenioenko/ttt/issues/952) | Plugin API: line highlights and notes between lines | aahoughton | 2026-10-17 | фича | плагины: decorations | CLOSED: исправлено (PR автора) | 0/3 | API: подсветка строк/спанов и заметки между строками (code tour, coverage, inline blame) |
| [#953](https://github.com/eugenioenko/ttt/issues/953) | Pasting into a plugin panel's input goes into the editor instead | aahoughton | 2026-10-17 | баг | плагины: paste в input | CLOSED: исправлено | 0/0 | Bracketed paste в input панели плагина уходит в редактор |
| [#955](https://github.com/eugenioenko/ttt/issues/955) | Plugin API: an input that wraps onto more than one row | aahoughton | 2026-10-18 | фича | плагины: многострочный input | CLOSED: исправлено | 0/0 | Многострочный input для чат-панелей плагинов |
| [#965](https://github.com/eugenioenko/ttt/issues/965) | Replace All in Files leaves matches after the 100th matching line in a file | jayhemnani9910 | 2026-10-18 | баг | поиск: Replace All | CLOSED: исправлено | 0/0 | Replace All in Files заменяет только первые 100 совпадений на файл (rg --max-count) |
| [#967](https://github.com/eugenioenko/ttt/issues/967) | Mouse code dumping after clicking "close all terminals" on Windows | lien-hung | 2026-10-18 | баг | платформа: Windows, терминал | CLOSED: исправлено (PR) | 1/3 | После 'close all terminals' на Windows сыплются коды мыши (двойное закрытие PTY) |
| [#971](https://github.com/eugenioenko/ttt/issues/971) | fix(plugin): propagate registry save failures when revoking permissions | app/coderabbitai | 2026-10-18 | бот/dev | плагины: права | CLOSED: исправлено | 0/0 | (CodeRabbit) ошибки сохранения реестра прав игнорируются |
| [#972](https://github.com/eugenioenko/ttt/issues/972) | Uninstalling a plugin leaves its status items, bookmarks and on_uninstall tabs behind | aahoughton | 2026-10-18 | баг | плагины: uninstall | OPEN: открыто (PR есть) | 0/0 | После удаления плагина остаются status items, закладки, табы |
| [#973](https://github.com/eugenioenko/ttt/issues/973) | Plugin API: let a plugin talk to a local companion process | aahoughton | 2026-10-18 | фича | плагины: сеть localhost | CLOSED: исправлено | 0/2 | Разрешить плагину ходить на 127.0.0.1:port (MCP-мост, локальные сервисы) |
| [#974](https://github.com/eugenioenko/ttt/issues/974) | Fix dirty-marker styling when an icon override matches tab-name characters | app/coderabbitai | 2026-10-18 | бот/dev | табы: dirty marker | CLOSED: исправлено | 0/0 | (CodeRabbit) стиль dirty-маркера применяется ко всем совпадающим символам |
| [#978](https://github.com/eugenioenko/ttt/issues/978) | Save As for untitled files should default to the current workspace folder | rafjaf | 2026-10-18 | баг | Save As / workspace | CLOSED: исправлено | 0/0 | Save As untitled сохраняет относительно cwd запуска, а не текущей папки workspace |
| [#989](https://github.com/eugenioenko/ttt/issues/989) | Require renewed approval for legacy hostname-list HTTP grants | app/coderabbitai | 2026-10-18 | бот/dev | плагины: права network | CLOSED: исправлено | 0/0 | (CodeRabbit) переодобрение старых network-грантов |
| [#990](https://github.com/eugenioenko/ttt/issues/990) | Plugin API: show or focus a plugin's panel, and follow growing content | aahoughton | 2026-10-18 | фича | плагины: show/focus панели | CLOSED: исправлено | 0/0 | API: показать/сфокусировать панель плагина, автоскролл растущего markdown |
| [#1050](https://github.com/eugenioenko/ttt/issues/1050) | Plugin panel dropdowns can't be reached from the keyboard | aahoughton | 2026-10-20 | баг/a11y | плагины: dropdown с клавиатуры | CLOSED: исправлено | 0/0 | Dropdown в панели плагина недоступен с клавиатуры |
| [#1088](https://github.com/eugenioenko/ttt/issues/1088) | Option to move sidebar to the right | philpax | 2026-10-22 | фича | layout: сайдбар справа | OPEN: открыто, needs design | 0/1 | Перенести сайдбар вправо; мейнтейнер думает о docking-системе |
| [#1099](https://github.com/eugenioenko/ttt/issues/1099) | INSTALL_DIR kind of ignored? | sduensin | 2026-10-22 | баг | установка: install.sh | CLOSED: исправлено (доки) | 0/1 | INSTALL_DIR игнорируется — переменная передавалась curl, а не sh |
| [#1102](https://github.com/eugenioenko/ttt/issues/1102) | Add Falcon Terminal to list of terminals that support Kitty graphics. | mike-ward | 2026-10-22 | фича | платформа: Falcon terminal, Kitty graphics | CLOSED: исправлено | 0/0 | Добавить Falcon в список терминалов с Kitty graphics |
| [#1104](https://github.com/eugenioenko/ttt/issues/1104) | nix run fails with Go dependency vendorHash mismatch | Catalyze4 | 2026-10-23 | баг | упаковка: Nix | CLOSED: исправлено | 1/1 | nix run падает из-за рассинхрона vendorHash |
| [#1125](https://github.com/eugenioenko/ttt/issues/1125) | [Feature Request]: Add support for jujutsu vcs (jj) | soderluk | 2026-10-24 | фича | VCS: jujutsu | OPEN: открыто | 0/0 | Поддержка jj |
| [#1126](https://github.com/eugenioenko/ttt/issues/1126) | Right Click Context Menu Not Dismissing | jonah-butler | 2026-10-24 | баг | платформа: macOS Tabby/Warp, mouse | OPEN: открыто (PR есть) | 0/0 | Контекстное меню переоткрывается на каждое движение мыши — терминал теряет release правой кнопки |
| [#1128](https://github.com/eugenioenko/ttt/issues/1128) | feat(markdown): give rendered Markdown visible structure (headings, links, GFM) | sercanatalik | 2026-10-24 | фича | markdown-рендер | OPEN: открыто (PR есть) | 0/0 | Markdown: уровни заголовков, ссылки, GFM task lists/strikethrough |
| [#1134](https://github.com/eugenioenko/ttt/issues/1134) | Option for auto-close bracket | lien-hung | 2026-10-25 | фича | editor: auto-close brackets | OPEN: открыто | 0/0 | Автозакрытие скобок (opt-in), как в VS Code/Zed |
| [#1135](https://github.com/eugenioenko/ttt/issues/1135) | feat(herdr): let the plugin config choose where the editor pane opens | flavour | 2026-10-25 | фича | интеграция: herdr | OPEN: открыто (PR есть) | 0/0 | Плагин herdr: настраиваемое размещение панели редактора |

## 2. Запрашиваемые фичи: ранжирование

Реакций нет ни у одной фичи, поэтому ранг выставлен по совокупности сигналов: число комментариев, повторы у разных людей (в том числе в комментариях к чужим issue и в PR), взята ли фича в работу.

| Ранг | Фича | Где просили | Что сделал TTT | Сигнал |
|---|---|---|---|---|
| 1 | **Альтернативные раскладки хоткеев: Vim и Emacs** | #386 (10 комм.), #423 (21 комм.), #567 | Сделал плагинами ttt-vim и emacs; ради них расширил Plugin API (глобальный перехват клавиш, regex, clipboard.read, fold-команды) | Самый обсуждаемый запрос; пользователь Vim «теперь буду пользоваться каждый день» |
| 2 | **Состояние между сессиями: autosave, local history, восстановление табов, pinned tabs, дефолтный workspace** | #284, #285 (6), PR #609, PR #1021, плюс собственные #71/#96/#97/#577 | Принципиально против неявного состояния. Autosave отклонён; session restore заменён opt-in файлом workspace; PR с автосейвом сессий закрыт | Повторяется у 3–4 человек и в 2 внешних PR |
| 3 | **Split editor / раскладка панелей** (сплит, сайдбар справа, docking) | #706, #1088, #75 (контрибьютор Tyler-widd возражает против закрытия) | Сплит отклонён («это делает tmux»); сайдбар справа — «needs design»; нижнюю панель справа уже можно | 3 независимых голоса |
| 4 | **Мелочи explorer'а и навигации по файлам**: reveal active file, reveal in file manager, copy path, скрытые файлы, Quick Open находит не все файлы, favorites, drag-n-drop в терминал | #223, #412, #742, #755, #467, #899, #729, #662 | Почти всё сделано, часто силами авторов issue | 8 issue, самый массовый кластер |
| 5 | **Git/diff в духе VS Code**: редактирование в diff, метки на скроллбаре, commit detail, PR review | #697, #671, #493, #534, #417 | Всё сделано; git-ревью — ключевой сценарий TTT («смотреть diff'ы от агентов») | 5 issue и большая серия PR arimxyer |
| 6 | **Подсветка синтаксиса**: многострочные конструкции HTML/JSX, shebang, внешние грамматики | #670, #812, PR #599/#601 | Переход с построчного chroma на собственный порт vscode-textmate (textmate-go) | 3–4 запроса; привели к смене движка |
| 7 | **Расширения Plugin API**: decorations, file handlers и картинки, многострочный input, show/focus панели, localhost-сеть | #952, #955, #973, #990, #813 | Всё принято за 1–2 дня | Тянут 2–3 автора плагинов (PDF-просмотрщик, code tour через MCP) |
| 8 | **AI inline suggestions (Copilot ghost text)** | #760 | Открыто, help wanted; мейнтейнер расписал путь через `@github/copilot-language-server` | 1 issue |
| 9 | **Совместимость LSP-клиента**: TS7 `tsc --lsp`, pull diagnostics, venv для pyright | #761, #446, #933 | Исправлено | 3 |
| 10 | Прочее по одной штуке: auto-close brackets (#1134), колонковые операции (#572, отклонено), локализация UI (#483), jujutsu (#1125), tgrep (#592), Omarchy-тема (#904, сделана плагином), markdown-рендер (#1128) | | | по 1 |

## 3. Кластеры боли (с подсчётом) и их значимость для Diode

### 3.1 Совместимость с терминалами и ОС: 17 issue (самый большой кластер багов)
См. §4. **Для Diode:** очень высокая значимость. Наш стек (Node + собственный TUI) упирается в те же ограничения терминалов: мышь, Cmd на macOS, Windows ConPTY, ширина символов.

### 3.2 Unicode, ширина символов, i18n: 5 issue у пользователей и около 8 своих
#281 (кириллица: курсор считался в байтах), #434 (CJK: каждый второй символ пропадал), #443 (китайский), #483 (локализация UI). У мейнтейнера ещё #1064–#1067 и #999 (fullwidth в заголовках, кнопках, чекбоксах, лейблах терминала) и #636. **Для Diode:** высокая. Баги ширины символов находят пользователи из России, Кореи и Китая в первые же дни. Нужен единый `displayWidth` во всех виджетах, а не только в редакторе. Отдельно стоит протестировать набор кириллицы: в первом отчёте был именно русский пользователь.

### 3.3 Хоткеи и мышечная память: 4 issue, самые длинные треды
#386 (Vim), #423 (Emacs и рант), #246 (Cmd+C/V на macOS), #567 (логгер частоты команд). Мейнтейнер: «`ctrl+shift+key` во многих терминалах просто не работает». **Для Diode:** высокая. Наши пользователи придут с VS Code, и у нас есть козырь: VS Code-совместимый extension host потенциально запустит готовое расширение VSCodeVim, а TTT пришлось писать Vim-слой с нуля. Проблему Cmd на macOS и Ctrl+Shift в терминалах придётся решать так же (kitty keyboard protocol, bracketed paste вместо Cmd+V).

### 3.4 Состояние, сессии, автосейв: 4 issue и 2 PR
#284, #285, #978 (Save As относительно cwd, а не workspace), PR #609 и #1021. **Для Diode:** высокая. Пользователи VS Code ждут hot exit, восстановление табов и `files.autoSave`. TTT от этого отказывается по идеологическим причинам («терминальный редактор без состояния»), и это наше возможное отличие.

### 3.5 Explorer, Quick Open, файловые операции: 10 issue
#223, #244, #245, #412, #467, #742, #755, #899, #729, #662. Типовые проблемы: Quick Open не находит файлы из-за лимита 10k при обходе, неочевидно, как показать скрытые файлы, нет reveal, нет copy path, `~` в пути не раскрывается. **Для Diode:** высокая и дешёвая — это базовые вещи VS Code. Особенно стоит взять: Quick Open через `rg --files` с fallback на `git ls-files`, а также Copy Path и Copy Relative Path.

### 3.6 Git и diff: 7 пользовательских issue и около 20 своих
#697 (редактирование в diff), #671 (скроллбар), #672 (OOM: LCS на 20k строк — 3.2 ГБ), #493, #417, #534, #1125 (jj). **Для Diode:** высокая. Пользователи TTT описывают его как «смотреть diff'ы от Claude Code» (#223, #386). Если у нас SCM идёт через расширения VS Code (vscode.git), часть этого достаётся даром. Урок #672: diff в gutter нужен с обрезкой общих префикса и суффикса и с отменой устаревших запросов.

### 3.7 LSP: 3 у пользователей и около 15 своих (аудит #876)
#761 (строковые JSON-RPC id, server→client requests, pull diagnostics), #933 (URI на Windows), #446 (venv). **Для Diode:** средняя. С extension host мы используем vscode-languageclient, и большая часть таких багов уходит. URI на Windows и выбор интерпретатора Python решаются расширениями.

### 3.8 Подсветка синтаксиса: 3 issue и 2 PR
#670, #812, #686. **Для Diode:** средняя. Мы и так на TextMate. Интересно, что TTT в итоге пришёл к той же архитектуре, что у VS Code, а построчный chroma оказался тупиком.

### 3.9 Плагины и API расширений: 11 внешних issue
#813, #904, #952, #953, #955, #972, #973, #990, #1050 и 2 от бота. **Для Diode:** средняя. Это спрос авторов плагинов, а не конечных пользователей. При этом показательно, что именно нужно сторонним авторам: декорации строк, inline-заметки, многострочный input для чат-панели, просмотр бинарных файлов (PDF, картинки через Kitty graphics), доступ к localhost для MCP-мостов. У VS Code всё это уже есть (decorations, webview, CustomEditor). **Ценность для нас — уметь отрисовать в TUI** `TextEditorDecorationType`, inline-вставки и CustomEditor.

### 3.10 Установка и упаковка: 6 issue
#266, #335, #1104 (Nix flake и vendorHash, трижды), #1099 (`INSTALL_DIR` в `curl | sh`), #695 (Termux/Android), а также PR со Scoop, Homebrew и FreeBSD. **Для Diode:** средняя. Пользователи терминальных редакторов с первого дня просят Nix, Scoop, Homebrew, Termux и FreeBSD. Single binary (SEA) упрощает дело, но флейк с хешами зависимостей ломался трижды.

### 3.11 Интеграция с мультиплексорами и средами (herdr, Omarchy, tmux): 4 issue
#594, #595, #1135 (herdr), #904 (Omarchy). **Для Diode:** средняя. Появляется класс «агентских мультиплексоров» (herdr), и пользователи хотят открывать в них редактор панелью.

### 3.12 AI-фичи: 1 issue
#760 (inline completion). **Для Diode:** средняя или высокая. Через extension host Copilot теоретически работает как обычное расширение, и это сильный аргумент в нашу пользу.

## 4. Совместимость с платформами и терминалами

| Платформа или терминал | Issue | Проблема | Итог |
|---|---|---|---|
| **Windows** (cmd, PowerShell, Windows Terminal) | #397 | Каждое нажатие клавиши дублируется (баг tcell v2) | Пришлось мигрировать tcell v2→v3 |
| Windows | #411 | Встроенный терминал не работает: creack/pty не умеет ConPTY | Сделали ConPTY |
| Windows | #933 | LSP не стартует: URI вида `file://C:%5CUsers...` | Исправлено |
| Windows Terminal | #967 | После «close all terminals» выводятся коды мыши (PTY закрывается дважды) | Исправлено PR сообщества |
| **macOS, iTerm2** | #246 | Cmd+C и Cmd+V не доходят до приложения, их перехватывает терминал | Cmd+V работает через событие bracketed paste; Cmd+C — только с выделением через Shift |
| macOS, iTerm2 и Ghostty | #244 | Не видно скроллбара, explorer не скроллится без фокуса | Исправлено |
| macOS, Terminal.app | #247 | Мышь не работает | Проблема окружения пользователя |
| **macOS, Tabby и Warp** | #1126 | Терминал теряет отпускание правой кнопки, после чего tcell считает её нажатой и контекстное меню открывается при каждом движении мыши | Открыто, есть PR |
| Ghostty | свои #559, #3 | Не работает Ctrl+click в терминале; копирование из diff | Исправлено |
| **Rocky Linux 9** (xfce-terminal, mate-terminal) | #883 | При выходе через клик мышью в шелл вываливаются коды мыши. Причина: down и up приходят с разницей 0 мс, и выход срабатывает до прихода up | Открыто; решение — выполнять действие на mouse-up, как в GUI |
| **Android, Termux** | #695 | Готовый бинарь linux-arm64 не запускается | Предложили сборку через `go install`; позже добавили android-arm64 (#1105) |
| armv7 | Discussion #502 | Не работало до фикса в xterm-go | Исправлено |
| Raspberry Pi Zero | свой #224 | 64% CPU уходило на подсветку chroma | Добавили кэш спанов |
| Kitty graphics | #1102 | Детект поддерживающих терминалов по списку (добавили Falcon) | Список вручную |
| Мультиплексор herdr | #594, #595 | cwd панели; падение с `open /dev/tty` при запуске без TTY | Исправлено |
| tmux | — | Отдельных багов нет, но мейнтейнер постоянно ссылается на tmux как на замену сплитам. Контрибьютор в #75: tmux искажает цвета и конфликтует по хоткеям | — |
| Ctrl+Shift-хоткеи | #423 | «Ctrl+Shift+key не поддерживается во многих терминалах» (мейнтейнер) | Ограничение терминалов |

**Выводы для Diode:**
1. **Мышь — главный источник платформенных багов** (5 из 17): потерянные release-события, down и up за 0 мс, мусор от mouse reporting после выхода или закрытия PTY. Нужно: выполнять действия на mouse-up, сбрасывать состояние кнопок при движении без зажатой кнопки и гарантированно выключать mouse reporting на выходе, в том числе при панике и закрытии PTY.
2. **Windows** — три критичных бага за первую неделю после появления Windows-пользователей. Мейнтейнер сам на Windows не тестировал («I use ttt in linux and macos»).
3. **Cmd на macOS** принципиально не решается. Работает только Paste через bracketed paste.
4. Stretch-цели — Termux, armv7 и RPi: пользователи их реально пробуют.

## 5. Отклонённые и отложенные запросы: философия мейнтейнера

| Запрос | Где | Решение и аргумент мейнтейнера |
|---|---|---|
| Split editor | #75 (свой), #706 | «tmux и современные терминалы (kitty, WezTerm) уже умеют сплиты — в этом смысл терминального редактора: использовать возможности терминала, а не переизобретать». «Второй инстанс — не обходной путь, а фича». Признаёт минус: у каждого инстанса свои language servers. «Если сообщество скажет, что must-have, — пересмотрю». |
| Autosave | #96 | «Сохранение должно быть явным решением пользователя; автосейв опасен для production-файлов на серверах». Позже согласился на opt-in вместе с локальной историей (#577). |
| Session restore | #71 | «ttt намеренно stateless, как традиционные терминальные редакторы». Вместо этого — opt-in `.ttt`-файл workspace. В #284: «терминальное приложение — то, что приносишь в любую папку; каждая сессия с нуля — ожидаемое поведение». |
| Snippets с tab stops из LSP | #77 | «Агентские workflow устранили потребность в сниппетах: агенты пишут код целиком». |
| Macro recording | #82 | «Агенты и multi-cursor закрывают эту потребность». |
| Колонковое и блочное выделение | #81, #572 | «Multi-cursor заменил column selection; не было нужно 20 лет». Отложено «пока не будет больше запросов». |
| Sticky scroll | #83 | «Визуальный шум; место в терминале дорого». |
| Breadcrumbs | #84 | «Шум; путь уже есть в статус-баре». |
| Indent guides, bracket pair colorization | #78, #86 | Низкий приоритет. Indent guides ограничены терминалом: можно только заменить пробелы на │. |
| MRU-список файлов | #95 | «У терминальных пользователей есть zoxide и история шелла». Оставлен только Ctrl+Shift+T. |
| Omarchy-тема в ядре | #904 | Не в ядро, а плагином: «хороший вызов для плагин-системы». |
| Spell checking (aspell) | PR #341 | Закрыт: «есть плагин». |
| Открытие файла без workspace | PR #569 | Отклонено: `ttt file` специально открывает только файл; для обоих — `ttt . file`. |
| Auto light/dark по теме терминала | PR #607 | Не принят: «объём больше, чем ценность» (OSC 11-запрос, поллинг). |
| Дефолтный стартовый workspace | PR #1021 | Отложено: нужно мнение сообщества, `ttt` должен открывать текущую папку. |
| tgrep | #592 | Закрыто молча. |
| Меню и F-клавиши («новелти из Win95», #423) | #423 | Меню оставлено сознательно: «визуальная память» пользователей VS Code и discoverability настроек. |
| Перенос `pr.review` из меню File | #417 | Отказ: «открыть PR — то же, что открыть папку diff'ов». |

**Сводка философии:** (1) «терминал — это платформа»: сплиты, сессии и MRU отдаются tmux, zoxide и шеллу; (2) никакого неявного состояния на диске; (3) «агенты заменили сниппеты и макросы»; (4) нишевые вещи уходят в Lua-плагины, ядро должно оставаться самодостаточным бинарём (по этой же причине отвергнут tree-sitter: «увеличивает бинарь до неудобного размера»); (5) при этом копировать UX VS Code, где это не противоречит пунктам 1–4 (меню, Ctrl+P, клавиатурные конвенции).

**Для Diode это прямые точки дифференциации.** Мы клон VS Code, и для нас естественны split editor, hot exit и восстановление сессии, autosave, snippets, sticky scroll, breadcrumbs, indent guides, bracket colorization, column selection (Shift+Alt). Всё это TTT сознательно отверг, а его пользователи всё равно об этом просят (#706, #1088, #284, #285, #572, PR #609).

## 6. Issue мейнтейнера как роадмап (298 штук)

Метки: enhancement — 97, good first issue — 66, bug — 51, help wanted — 37. Открыто 27.

**Хронология:**
- **Май–июнь 2026 (#3–#185): «паритет с VS Code».** Тиры фич с пометкой источников «VS Code, Zed, Sublime, HN, Reddit»: session restore, навигация back/forward, go to symbol, code actions UI, inlay hints, git gutter, outline, word wrap, бытовые команды (sort lines, case transform, join lines). Затем серия «Audit: …» (#159–#173, агентский аудит качества кода).
- **Июнь–июль (#224–#426): плагины и стабильность.** Плагин-система на Lua (#243, большой дизайн-тред: панели, VStack/HStack, встроенные плагины как проверка API), RPi (#224), гонки и потеря данных (#291–#313), миграция на tcell v3 (#402), RPC-режим для агентов (#381, `--listen`).
- **Август–сентябрь (#444–#700): производительность и платформа.** Большие файлы (package-lock.json), терминал (mouse forwarding, xterm-go), per-workspace state (#577), прозрачный фон, мультирепо в не-git корне (#584), stdin как буфер (`git diff | ttt`, #627), внешние TextMate-грамматики (#676).
- **Октябрь (#713–#1118): diff-редактор и LSP.** Перенос подсветки в фон, DiffEditorWidget на основе редактора с редактированием (#785–#802), stage/unstage hunk (#768), LSP-аудит (#876, #864–#875), большие файлы (#860, log mode #944, отключение word wrap для файлов больше 32 МБ), волна мелких «good first issue» для внешних контрибьюторов (fullwidth в виджетах, плагинные права и безопасность: SSRF, symlink race), бинари для Android и Windows arm64.

**Открытые планы (27):** code actions UI Ctrl+. (#74), bookmarks (#87), merge conflict UI (#89, есть PR #1019), reopen closed tab (#95), автодетект Nerd Font (#611), selection inverse (#633), логгер частоты команд (#567), log mode (#944), commit detail find (#763), large-file perf (#860), LSP-аудит (#876), multi-cursor copy/paste (#918), фокус после закрытия оверлея портит файл (#578), markdown details/summary (#1034), гонка при закрытии терминала (#1114).

**Наблюдение:** TTT развивается как **агентский проект**: issue пишут в формате «Completion contract / Acceptance criteria», метки «good first issue» используются как раздача задач внешним агентам, много chaos monkey и тестов. Скорость высокая: около 1100 номеров issue и PR за 5 месяцев.

## 7. Discussions (4)

| # | Категория | Автор | Суть |
|---|---|---|---|
| 1120 | Ideas | pobfdm | «Открывать файл из любого места, а не только из стартовой папки». Ответов нет. |
| 981 | General | мейнтейнер | Опрос: что по умолчанию показывать в диалоге выхода с несохранёнными изменениями (Cancel/Quit или Save All & Quit). Голоса реакциями; итог не зафиксирован. |
| 502 | General | мейнтейнер | «Chat» для контрибьюторов: «с агентской работой коллаборация упала, потому что для укладки кирпичей кода она не нужна, и это плохо». Убрал обязательное ревью для мержа доверенным контрибьюторам. Пользователь благодарит за поддержку armv7. |
| 339 | Announcements | мейнтейнер | «How do you use TTT?» — сбор сценариев. Ни одного ответа. |

Show-and-tell и Q&A нет. Сообщество живёт в issue и PR, а не в Discussions. Сценарии использования видны из issue: просмотр diff'ов от Claude Code и других агентов, лёгкий файловый менеджер рядом с агентом (#223), работа в herdr и Omarchy, NixOS.

## 8. Внешние PR (кратко)

217 внешних PR (176 merged, 26 open, 15 closed) от 67 авторов. Топ: arimxyer (33: вся git-ревью подсистема — история коммитов, дерево файлов, live changes), SimonOcampo1 (17: welcome page, clone repository, desktop launcher, фиксы терминала, LSP URI), aahoughton (15: LSP TS7 и pull diagnostics, decorations, сеть плагинов), jayhemnani9910 (13: git и поиск), Hrushikesh-ramilla (10), sercanatalik (10: file handlers, картинки, PDF-плагин), ulrichheringer (10: bookmarks, merge conflicts, persist startup folders — открыты). Заметные PR от остальных: Outline-панель (tenox7), картинки через Kitty graphics (sjdonado), Nerd Font иконки, тема VSCode Dark+ (DBinK), Scoop, Homebrew, FreeBSD.
Закрытые без мержа (показательно): aspell (#341, есть плагин), автосейв сессий (#609), welcome screen v1 (#610, UX-замечания), auto light/dark (#607, раздут), `ttt file` без workspace (#569).

## 9. Итог: что взять Diode

1. **Платформенная надёжность мыши и ввода** — главный источник багов у TTT. Нужен матричный тест: Windows Terminal, iTerm2, Terminal.app, Ghostty, kitty, Tabby, Warp, xfce-terminal, tmux, Termux.
2. **Ширина символов во всех виджетах**, отдельный тест на кириллицу и CJK.
3. **Ключевой сценарий пользователей TTT — «IDE-компаньон для AI-агента в терминале»**: смотреть и править diff'ы, explorer с copy path, drag-n-drop пути в терминал, Ctrl+click по путям в выводе терминала. Мы уже делаем Ctrl+click (#841 у нас).
4. **То, что TTT отверг, а пользователи просят** — наша дифференциация: split editor, восстановление сессии и hot exit, autosave, snippets, column selection, сайдбар справа.
5. **Vim и Emacs через расширения VS Code** (VSCodeVim) вместо собственной реализации — сильный аргумент для пользователей Vim.
6. **Copilot и inline completion через extension host** — TTT только планирует это (#760).
7. **Упаковка**: Nix flake, Scoop, Homebrew, Termux, FreeBSD, `curl | sh` с `INSTALL_DIR` на стороне `sh`.
