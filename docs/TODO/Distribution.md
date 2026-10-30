# Distribution — каналы дистрибуции

Цель: ставится одной командой везде, где живёт наша аудитория (ssh, контейнеры, Windows-терминал),
и обновляется без нашего участия. Ориентир по набору каналов — [fresh](https://github.com/sinelaw/fresh)
(16 каналов, sha256 у каждого ассета, `install.sh` с автоопределением). Реализация — `packaging/`
([README](../../packaging/README.md)), пользовательская страница — [docs/public/INSTALL.md](../public/INSTALL.md).

## Сделано

Все каналы работают с v0.4.0: `install.sh` (`--method=binary|apt|brew|npm`), apt (плоский репозиторий
ассетами релиза с историей версий), npm `@diode-editor/diode` (Trusted Publishing), Homebrew cask,
winget-манифесты, версия на лендинге; лицензия GPL-3.0-or-later и `THIRD-PARTY-NOTICES.md`,
`.sha256`-сайдкары у каждого ассета. Формат бинаря — решение человека 2026-10-15: SEA везде (V8-снапшот
ядра возможен только в SEA), selfextract — только Intel macOS, где node не собирает рабочий SEA.
Антивирусный скан SEA прошёл в пайплайне winget-pkgs на v0.3.0. Устройство, секреты и ручные шаги — [packaging/README.md](../../packaging/README.md).

## Открыто

- [ ] Секрет `SITE_PAT` (fine-grained, только `diode-editor.github.io`, Contents: read and write) — до него
      job `site` красная; проверить первым же релизом или ручным запуском `site-version.yml`.
- [~] Первая подача в winget: PR [microsoft/winget-pkgs#442141](https://github.com/microsoft/winget-pkgs/pull/442141)
      (2026-09-27, ветка `DiodeEditor.Diode-0.3.0` в форке `tihonove/winget-pkgs`, коммит через
      Git Data API — клон с `tree:0` при push дотягивает всё дерево). 2026-10-30 модератор вернул PR
      (`Needs-Author-Feedback`, `Manifest-Version-Deprecated`): манифест 1.12.0 устарел, нужен 1.28.0.
      В тот же день `packaging/render.mjs` поднят до 1.28.0, а PR переведён на версию 0.12.3 (0.3.0 не
      работала на Windows, см. ниже); имя ветки осталось старым. После мержа — секрет
      `WINGET_TOKEN` (PAT с `public_repo`), дальше версии подаёт `release.yml`.
- [ ] Не проверено руками: `winget install DiodeEditor.Diode` (после мержа PR) — нужна Windows.
- [ ] **Windows-SEA до 0.8.5 не узнавал себя** (найдено в #612): `isSeaBinary()` на Windows всегда
      отвечал `false` (`createRequire("file:///")` на win32 бросает), и бинарь искал `diode.bundle`,
      куски xterm и iconv файлами рядом с exe, а не во вшитых ассетах. В e2e это маскировали файлы
      сборки рядом с бинарём. Исправлено в #612 (вошло в 0.8.5), но коммит — `build(bundle)`, и в
      changelog фикса нет. Нужна ручная проверка релиза 0.8.5 на чистой Windows (без файлов сборки
      рядом): старт с файлом и подсветкой, встроенный терминал, Reopen with Encoding в
      windows-1251. И строка в заметки релиза 0.8.5: «Windows: бинарь находит вшитые расширения,
      терминал и кодировки».
- [ ] Сайт: команда quick install на лендинге и копия `install.sh` по короткому адресу
      `diode-editor.github.io/install.sh` (репозиторий сайта).

## Дальше

- [ ] Devcontainer feature `ghcr.io/diode-editor/features/diode` — аудитория из VISION живёт в девконтейнерах.
- [ ] scoop bucket (Windows без winget), AUR `diode-bin` (после лицензии — только PKGBUILD).
- [ ] Режим «запуск из системного node» (`main.cjs` + `diode.bundle` без SEA/selfextract): открывает
      homebrew-core, nixpkgs и порт FreeBSD, которым нужна сборка из исходников. Требует ещё
      и notability (у homebrew-core — звёзды/форки).
- [ ] Подпись: Apple Developer ID для нотаризации macOS (Gatekeeper на бинарь из браузера),
      code signing для Windows (SmartScreen). Оба — деньги, не код.
