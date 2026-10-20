# Первый выпуск: скоуп оптимизаций и чеклист

Статус: `[~]` — скоуп зафиксирован 2026-09-26 и пересмотрен 2026-10-13: дистрибуция и витрина
сделаны; до поста добавлены перф-этапы 1–2, честные цифры, эссе и кадр-доказательство.

Рамка выпуска — раздел «План выхода на публику» в [VISION.md](../VISION.md): появление №1 —
эссе про extension host без Electron, не Show HN. Релиз привязан к демо-кадру «терминал,
выглядящий как VS Code: тема Dark+, TextMate-грамматики, живой LSP, автокомплит», а не к паритету
фич. Этот документ — что из перф-работ и обвязки обязано быть правдой до поста, в каком порядке
и что осознанно отпущено после.

## Решение

Пересмотр 2026-10-13. Публичные цифры старта («103 мс, 26 мс воркбенча» в BENCHMARKS.md и
на лендинге) устарели: пол тогда считали по `node --version`, а честная линейка (#356) даёт
321 мс наших над полом node на `small` локально и ≈400 на CI. С такими цифрами пост выходить
не может. Поэтому до поста идут **перф-этапы 1 и 2** из [OpenPerformance.md](OpenPerformance.md)
(кухня старта и жадные проходы), исправленные цифры, эссе с заготовленными ответами и
кадр-доказательство. Большие файлы (этапы 3–4), хвосты длинных строк и дерева, нативный
watcher и Go в магазине — после поста.

## Сделано

- [x] **Установка одной командой**: `install.sh` на сайте (`curl | sh`, методы binary/apt/brew/npm),
      apt-репозиторий, npm-обёртка `@diode-editor/diode`, brew cask — [packaging/README.md](../../packaging/README.md).
- [x] **Витрина на лендинге**: бейдж alpha, ссылки на [ROADMAP.md](../public/ROADMAP.md),
      [API-COVERAGE.md](../public/API-COVERAGE.md) и [BENCHMARKS.md](../public/BENCHMARKS.md).
- [x] **`.gitignore` в поиске и Quick Open** (#593). Дерево (`explorer.excludeGitIgnore`) — нет,
      это хвост дерева «после поста».
- [x] **Перф-гейт старта** `e2e/bench/startupBudget.bench.ts`: бюджет
      `STARTUP_BUDGET_OURS_MS = 200` мс наших над полом node на `small` (факт ≈175).

## До поста

### Перф: старт и открытие файла

- [~] **Этап 1 [OpenPerformance.md](OpenPerformance.md)** — кухня старта: было 321 мс наших на
      `small`, сейчас ≈175 (распил бандла, CJS-ядро, V8-снапшот в SEA), гейт зажат до 200. Цель
      ≤ 50 мс; открытые рычаги — в OpenPerformance.
- [ ] **Этап 2 [OpenPerformance.md](OpenPerformance.md)** — жадные проходы: файл до десятков МБ
      открывается как маленький (`xlarge` ≤ `small` + 100 мс), клавиша не зависит от размера
      (сюда же `Ctrl+End` на `xlarge` — 9.2 с).

### Цифры, тексты, кадр

- [ ] **Честные цифры**: сравнительная таблица vim · nvim голый · nvim+LazyVim/NvChad · helix ·
      diode одним прогоном на одной машине, методика — в [BENCHMARKS.md](../public/BENCHMARKS.md);
      исправить «103 мс / 26 мс воркбенча» там и «~100 ms» на лендинге — сейчас это неправда.
- [ ] **Эссе** про extension host без Electron и **заготовленные ответы** на неизбежные вопросы:
      «почему не neovim/helix», Remote-SSH, Node и перф, webview, легальность использования
      магазина (Open VSX, не Microsoft Marketplace), «это вайбкодинг?».
- [ ] **Кадр-доказательство на лендинге**: Dark+, TextMate-грамматики, живой LSP, автокомплит,
      актуальная версия в статус-баре — снят с релизного бинаря, а не собран руками.

## После поста

- **Большие файлы** — этапы 3–4 [OpenPerformance.md](OpenPerformance.md): PieceTree, стриминговое
  чтение, large-file режим (`largeFileOptimizations`).
- **Длинные строки** — хвосты [LongLinePerformance.md](LongLinePerformance.md#осталось):
  пер-строчный кеш `DisplayLine`, ленивое окно вьюпорта, reveal-по-клику, `editor.stopRenderingLineAfter`.
- **Дерево файлов** — хвосты [FileTreePerformance.md](FileTreePerformance.md#будущие-фиксы-вне-scope-текущей-задачи):
  `explorer.excludeGitIgnore`, индекс по ключу в `TreeViewElement`, CamelHumps в `FuzzySearch.ts`,
  бюджет на кадр в `search`, инкрементальная сверка индекса от watcher'ов.
- **Нативный watcher `@parcel/watcher`** вместо chokidar — не раньше уведомления про ENOSPC
  ([EnvironmentTuning.md](EnvironmentTuning.md)); платформенная матрица сборки под SEA.
- **Go в магазине** (стоковый `golang.go` + gopls, пул задач — [GoLSP.md](GoLSP.md)). Тезис «не только TS/Python» к посту уже держат
  Java, Terraform и Python.
- **Damage-tracking кадра** (LongLinePerformance.md «Осталось»): hover-damage, пер-item damage в
  `OverlayLayer`, сужение страховки consumed-key, клип-ограничение цикла строк редактора.
- **Фоновая токенизация** ([VscodeModel.md](VscodeModel.md))
  — не главная: токенизация уже ленивая до вьюпорта, фоновая лечит в основном прыжок в конец
  большого файла, а это ближе к этапу 2.
- **Semantic tokens из LSP** — новый источник токенов, а не оптимизация; к демо-кадру не относится.

## Открытые вопросы

- Записи магазина ко дню релиза сверх Java, Terraform и Python: Go, Rust, C#.
- Где живёт MCP-сервер (появление №2) — не блокирует, см. VISION «Открытые вопросы».

## Цена прогона

По CPU-минутам самое дорогое — мутационный гейт и e2e на SEA-бинаре по каждой части распила
(этап 1), бенчи `bench:open` до и после. См. [TestRunTime.md](TestRunTime.md).
