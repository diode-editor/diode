# TTT Editor (eugenioenko/ttt) — разбор конкурента

Срез на 2026-10-25, HEAD `main` b48bece1 (v1.9.0). Источники: клон репозитория (только чтение),
`gh` (issues, PR, релизы), HN Algolia, архив Reddit через pullpush.io, tttedit.dev, herdr.dev,
пресса. Разбор трекера целиком (все 76 внешних issue, платформенные баги, отказы мейнтейнера) —
[TTT-issues.md](TTT-issues.md). Выводы для нашего выхода на публику — [MARKETING.md](../MARKETING.md).

## Паспорт

- **Что:** терминальная IDE на Go. «The IDE that lives in your terminal. A TUI that feels like GUI.
  A real alternative to VS Code, Zed, and Sublime». Сайт [tttedit.dev](https://tttedit.dev). MIT,
  монетизации нет и не планируется («None of the projects I build are intended for monetization»).
- **Автор:** Eugene Yakhnenko (eugenioenko, работает в Virtru), соло-мейнтейнер: 1466 из 1670
  коммитов с его почты. Bus factor = 1. Цель в его словах: «pull vscode crowd into the terminal».
- **Возраст:** репозиторий с 2026-01-16, реальная работа с 2026-05-19. v0.1.0 — 25.05, v1.0.0 —
  08.07, v1.9.0 — 22.10; 29 релизов, после 1.0 — раз в 1–2 недели.
- **Объём:** ~80 тыс. строк production Go, ~83 тыс. строк тестов. Бинарь 14–16 MiB, 9 платформ
  (linux/darwin/freebsd amd64+arm64, android/arm64, windows amd64+arm64).
- **Процесс — агентный:** ~1300 из 1670 коммитов с `Co-Authored-By: Claude`, AGENTS.md, CodeRabbit,
  «🤖»-ответы в issues. Фичу часто делают в нескольких UX-вариантах параллельно (7 веток
  комментариев к PR висят с июня). 217 внешних PR от 67 авторов, многие — тоже агентами.
- **Тракшн:** 841 звезда, 96 форков. Больше половины звёзд — за последние 18 дней (см. «Внешнее
  восприятие»). Скачиваний ~200 на релиз летом, ~1500 в октябре.

## Что у них есть

- **Ядро:** буфер `[]string` (`internal/core/buffer`), undo на паттерне Command, мультикурсор
  (copy/paste только на основном курсоре, #918), фолдинг только по отступам. Большие файлы
  вылизаны (#860): 128 MiB открываются за ~0,3 с, память 2,2–2,6× файла; log mode — PoC (#944).
- **Подсветка:** свой порт движка VS Code TextMate на Go — [textmate-go](https://github.com/eugenioenko/textmate-go),
  124 грамматики, заменил chroma 27.09 (#675) после бага с многострочным JSX. Токенизация на
  UI-потоке порциями между событиями.
- **LSP:** свой клиент. Только full-document sync, один `rootURI` без `workspaceFolders`,
  `snippetSupport: false`. Есть completion/resolve, signature, hover, переходы, references,
  rename, formatting, organize imports, outline, pull diagnostics. Нет inlay hints, semantic
  tokens, codeLens, workspace/symbol, quick-fix. Вшитые конфиги серверов удалены 30.06 —
  серверы пользователь ставит сам, «lsp-плагины» лишь прописывают команду в настройки.
- **Git — сильнейшая часть:** стейджинг, DiffEditorWidget (split/unified, changes-only с
  раскрываемыми gap-строками), **редактируемый live-diff прямо во вкладке файла** (#795), метки
  на скроллбаре с точностью 1/8 ячейки (#895, #903), blame в статус-баре, история и детали
  коммитов, просмотр GitHub PR по URL через `gh` (только чтение).
- **Терминал:** форк xterm-go, go-pty (ConPTY на Windows), OSC 133, Ctrl+click по URL и
  `file:line:col`, курсор и ячейки из одного снимка (комментарий прямо про Claude Code).
- **Картинки:** только Kitty graphics, детект терминала по env, под tmux выключено.
- **Темы:** 20 встроенных + 78 скачиваемых, свой формат; из VS Code импортируются только
  `tokenColors`, не `colors`.
- **Клавиши:** «вдохновлены VS Code», но Ctrl+P — палитра, Quick Open — Ctrl+K P, Ctrl+R —
  replace; `keybindings.json` без `when`. Vim и Emacs — Lua-плагинами.
- **Оболочка:** меню-бар, контекстные меню, диалоги, мышь везде, Settings UI с Apply/Cancel и
  пометкой *(restart)*, `?` в палитре — поиск по справке, welcome-страница, multi-root через
  файлы `.ttt`.
- **Плагины:** Lua 5.1 (gopher-lua), отдельный LState на плагин, ~28 разрешений с одобрением при
  установке; неразрешённых функций просто нет в модуле. Широкое API (виджеты, диалоги,
  decorations, diagnostics, file handlers, fs/net/exec со scoping, terminal, rpc, automation).
  Реестр — `community-plugins.json` в репозитории: 53 записи, из них 34 — однострочные пресеты
  LSP/форматтеров; почти всё написал автор. Установка — `git clone`, без подписей.
- **AI — управление снаружи, а не чат внутри:** `--exec` («fast Playwright for the terminal»,
  каждое действие подтверждается после перерисовки, `debug` — дамп состояния в JSON),
  `--listen` (HTTP на 127.0.0.1:4242), `llms.txt`, `ttt.terminal` для запуска агента во вкладке,
  [ttt-mcp](https://github.com/eugenioenko/ttt-mcp) (с 21.10): MCP-сервер, к которому плагин в
  каждом редакторе подключается по unix-сокету (#1058, `ttt.rpc` + `ttt.automation`).
- **Дистрибуция:** brew tap, AUR, Scoop, Nix flake, подписанный APT, Termux, FreeBSD,
  `go install`, `curl | sh`, плагин для [Herdr](https://herdr.dev).
- **Инженерия тестов:** 3098 Go-тестов (450 E2E на SimScreen), ~470 функциональных через
  `--exec`, chaos monkey в Docker с replay по seed; перед релизом 1 млн chaos-событий и 100
  прогонов с `-race`. В CI бенчмарки base против PR на настоящем бинаре (логи 1/128/256 MiB).

## Чего у них нет

1. **Совместимости с расширениями VS Code — совсем:** ни VSIX, ни extension host. Всё, что в
   VS Code живёт в расширениях, автор переписывает на Lua по одной штуке.
2. **Полноценного LSP** (см. выше) и серверов из коробки.
3. **Точной мышечной памяти VS Code:** другие хоткеи, нет `when`.
4. **Того, что отвергнуто идеологически** (подробности и цитаты — [TTT-issues.md §5](TTT-issues.md#5-отклонённые-и-отложенные-запросы-философия-мейнтейнера)):
   split editor («это делает tmux»), autosave и восстановление сессии («ttt stateless»),
   сниппеты («агенты их заменили»), sticky scroll, breadcrumbs, колонковое выделение.
   Пользователи это всё равно просят (#706, #1088, #284, #285, #572, PR #609).
5. **DAP** (ветка с июня без UI; самый частый запрос в Reddit-тредах), tasks, remote/SSH,
   AI inline completion (только идея, #760), auto-close скобок (#1134).
6. **Изоляции плагинов:** Lua-колбэки на UI-потоке без лимита — зависший плагин вешает редактор.

## Направление (сигналы, роадмапа у них нет)

1. Плагинная платформа — главный вектор октября (~57 коммитов).
2. Редактор как инструмент для внешних агентов: exec/listen, terminal API, ttt-mcp.
3. Большие файлы и log mode; раскладка окна (прототип сетки 3×3, #1088); merge conflicts
   (#1019), закладки; jj (#1125).
4. WASM-демо для сайта (#840). DAP заморожен.

## Внешнее восприятие

- **Show HN 2026-06-17** ([48571090](https://news.ycombinator.com/item?id=48571090)) — 4 очка,
  4 комментария, на v0.3 через четыре недели разработки. Главный ответ: «Looks like a nice editor
  (not an IDE)… Have you seen Fresh?».
- **Reddit — основной канал** (автор пишет как u/FitDirector3051):
  - r/commandline, 06-17: оба поста (28 и 15 очков) **удалены модераторами — «software being
    largely AI-generated»**; r/golang — удалён тоже.
  - r/tui: [19.06](https://www.reddit.com/r/tui/comments/1ua3ylb/) — 45 очков,
    [v1.0, 15.07](https://www.reddit.com/r/tui/comments/1uxktx1/) — 81 очко (лучший пост).
  - r/commandline, [1.7, 08.10](https://www.reddit.com/r/commandline/comments/1x0s6ni/) — ~37
    комментариев, с четвёртой попытки.
  - **Полезнее собственных постов — чужие треды:** r/linux «Alternatives to VS Code that aren't
    slop factories?» ([1voe9ti](https://www.reddit.com/r/linux/comments/1voe9ti/), 283 очка, 540
    комментариев) — ответ «ttt»; r/ClaudeCode про Herdr ([1x18t52](https://www.reddit.com/r/ClaudeCode/comments/1x18t52/)):
    «Lightweight vs code clone… If you dont have ttt. You are missing out»; r/HelixEditor.
- **Хвалят:** «like vs code in terminal», «monaco embedded?», выпадающие меню (переходят с
  Micro), шустрость на Raspberry Pi Zero (где Fresh тормозил), чистый вид.
- **Ругают:** «vibe coded slop», «IDE feel in a terminal is nonsensical», «nothing replaces the
  nvim ecosystem»; баги — AUR-сборка просила креды GitHub, escape-коды мыши в шелле после выхода.
  Автор на «это AI?» оправдывался задним числом: «Yes, extremely heavy AI usage. Is it a
  vibecoded toy? Nop… 500 commits…».
- **Пресса:** [It's FOSS, 22.10](https://itsfoss.com/terminal-text-editor/) («surprisingly
  polished», AI упомянут), [LinuxLinks, 01.08](https://www.linuxlinks.com/ttt-editor-ide-style-text-editor/),
  [Awesome Go Weekly #543](https://go.libhunt.com/newsletter/543), [Terminal Trove](https://terminaltrove.com/ttt-editor/),
  одно видео на YouTube. Lobsters, dev.to, X — пусто.
- **Звёзды** (по star-history, ±5): ~4 (14.06) → ~57 (23.06, Show HN и Reddit) → ~113 (v1.0) →
  ~202 (02.09) → ~248 (11.09, плагин Herdr с 04.09) → ~387 (07.10) → ~593 (16.10: пост 1.7,
  r/ClaudeCode, v1.8) → 841 (25.10: It's FOSS, v1.9, ttt-mcp). **Запуск дал мало; перелом в
  октябре пришёл из агентной среды и прессы.**

## Herdr

[herdr.dev](https://herdr.dev) — рантайм для кодинг-агентов (Herdr, Inc., Apache-2.0): агенты
(Claude Code, Codex, opencode, … — по их словам 22) живут в терминалах на фоновом сервере, есть
статусы «работает / ждёт ввода», CLI и socket API для агентов, машины по SSH, плагины. По данным
сайта — ~45 тыс. звёзд и ~1,6 млн установок (их цифры). У TTT свой `herdr-plugin` (с 04.09):
открывает редактор панелью в активном worktree, правый клик уходит в TTT. Это ровно наша
аудитория из [VISION.md](../VISION.md) — люди, которых агенты затащили в терминал.

## Ниша — соседи

| Проект | Звёзды | Язык | Заметка |
|---|---|---|---|
| [sinelaw/fresh](https://github.com/sinelaw/fresh) | ~9,3k | Rust | Главный соперник всех; Show HN 2025-12 — 187 очков / 150 комм. |
| [microsoft/edit](https://github.com/microsoft/edit) | ~14,7k | Rust | Минималистичный немодальный |
| [micro](https://github.com/micro-editor/micro) | ~29,8k | Go | С него уходят на TTT и Fresh |
| [paradise-runner/toast](https://github.com/paradise-runner/toast) | ~284 | Go | «batteries-included in-terminal IDE»; Show HN 2026-09 — 82 очка |
| [PNANA](https://github.com/Cyxuan0311/PNANA) | ~328 | C++ | По мотивам Nano/Micro/Sublime |
| cleecode, mnml, numentext, Tmux-IDE | <100 | — | Мелочь |

Ни у кого из них нет extension host VS Code.

## Что забрать

Продуктовое (проверить, чего у нас нет, и завести в трекер):
- индикатор состояния LSP в статус-баре с переходом в OUTPUT по клику;
- `?` в палитре — поиск по справке; шорткаты в меню из текущих биндингов;
- Quick Open через `rg --files` с откатом на `git ls-files`;
- плагин для Herdr — дешёвый канал в нашу аудиторию.

Инженерное:
- бенчмарки base против PR на реальном бинаре с комментарием в PR;
- chaos-прогон с replay по seed как предрелизный гейт;
- скриптовый харнесс в продакшен-бинаре (`--exec`/`--listen`) — у нас близкое делает `drive`,
  его же можно отдать агентам наружу (появление №2 в VISION).

Платформенные грабли, которые прогнать на живом diode до поста, —
[TTT-issues.md §4](TTT-issues.md#4-совместимость-с-платформами-и-терминалами): мышь в Tabby/Warp
(#1126), down/up за 0 мс и escape-коды мыши после выхода (#883, #967), Cmd+C/V на macOS (#246),
кириллица и CJK (#281, #434), Termux (#695), URI на Windows (#933).
