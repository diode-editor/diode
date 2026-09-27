# Distribution — каналы дистрибуции

Цель: ставится одной командой везде, где живёт наша аудитория (ssh, контейнеры, Windows-терминал),
и обновляется без нашего участия. Ориентир по набору каналов — [fresh](https://github.com/sinelaw/fresh)
(16 каналов, sha256 у каждого ассета, `install.sh` с автоопределением). Реализация — `packaging/`
([README](../../packaging/README.md)), пользовательская страница — [docs/public/INSTALL.md](../public/INSTALL.md).

## Сделано (2026-09-27)

- [x] `LICENSE` — GPL-3.0-or-later; `THIRD-PARTY-NOTICES.md` для MIT-кода vscode и bundled-компонентов.
      Без лицензии не проходят winget (поле License), npm и любые сторонние пакетные репозитории.
- [x] `.sha256`-сайдкары у каждого ассета (`build.yml`) — их читают установщик, npm и рендер манифестов.
- [x] `install.sh` — POSIX, curl или wget, sha256, `/usr/local/bin` или `~/.local/bin`, `DIODE_VERSION`,
      `DIODE_INSTALL_DIR`. Проверен на живом v0.3.0.
- [x] apt — `.deb` через `dpkg-deb` (без nfpm), плоский репозиторий ассетами релиза, подпись GPG.
      Цепочка `apt update` → `InRelease` по `signed-by` → `Packages.gz` → `.deb` проверена локально
      через сервер с 302-редиректами как у GitHub; GitHub принимает путь `/./InRelease`, который шлёт apt.
- [x] npm — `@diode-editor/diode`, тонкая обёртка с докачкой бинаря и sha256; `npx` работает.
      Проверено: `npm pack` → `npm install -g --prefix` → `diode --version` = 0.3.0.
- [x] Homebrew — формула с `on_macos`/`on_linux` × `on_arm`/`on_intel`, рендерится из sha256.
- [x] winget — три манифеста `DiodeEditor.Diode`, `InstallerType: portable`.
- [x] `release.yml` — jobs `packages`, `npm`, `brew`, `winget`; каждая молча пропускается без своего секрета.
- [x] `README.md` — только quick install; остальное на INSTALL.md.

## Чтобы заработало (руками, один раз)

- [x] `packaging/apt/gen-key.sh` → секреты `APT_GPG_PRIVATE_KEY` (base64 armored-ключа, печатает
      скрипт) и `APT_GPG_PASSPHRASE` заведены 2026-09-27; ключ и пароль — в парольнице владельца.
      Путь ключа проверен локально: генерация с паролем → base64 → импорт «в CI» → подпись →
      проверка опубликованным keyring.
- [x] `@diode-editor/diode@0.3.0` опубликован руками 2026-09-27, `npx` с чистого кэша работает.
- [ ] Trusted Publisher (GitHub Actions, `release.yml`) в настройках пакета на npmjs.com —
      проверится первым OIDC-релизом (packaging/README.md).
- [x] Репозиторий `diode-editor/homebrew-tap` создан, в нём формула v0.3.0 (2026-09-27).
- [ ] `REPOSITORY_PAT` должен иметь push в `homebrew-tap`: classic-токен со scope `repo` покрывает
      все репозитории организации, fine-grained — только перечисленные в «Repository access»
      с Contents: read and write. Проверка: `curl -H "Authorization: Bearer $PAT"
      https://api.github.com/repos/diode-editor/homebrew-tap` → `"permissions": {"push": true}`.
- [~] Первая подача в winget: PR [microsoft/winget-pkgs#442141](https://github.com/microsoft/winget-pkgs/pull/442141)
      (2026-09-27, ветка `DiodeEditor.Diode-0.3.0` в форке `tihonove/winget-pkgs`, коммит через
      Git Data API — клон с `tree:0` при push дотягивает всё дерево). После мержа — секрет
      `WINGET_TOKEN` (PAT с `public_repo`), дальше версии подаёт `release.yml`.
- [ ] Тег `vX.Y.Z` через `bump-version.yml` — первый релиз, у которого есть сайдкары, `.deb` и apt.
- [ ] После релиза проверить на живом: `install.sh` (sha256 OK), `apt update` на Debian/Ubuntu,
      `brew install diode-editor/tap/diode` (macOS и Linux), `npx @diode-editor/diode --version`,
      `winget install DiodeEditor.Diode`.
- [ ] Сайт: команда quick install на лендинге и копия `install.sh` по короткому адресу
      `diode-editor.github.io/install.sh` (репозиторий сайта).

## Дальше

- [ ] Devcontainer feature `ghcr.io/diode-editor/features/diode` — аудитория из VISION живёт в девконтейнерах.
- [ ] scoop bucket (Windows без winget), AUR `diode-bin` (после лицензии — только PKGBUILD).
- [ ] Режим «запуск из системного node» (`main.js` + `diode.bundle` без SEA/selfextract): открывает
      homebrew-core, nixpkgs и порт FreeBSD, которым нужна сборка из исходников. Требует ещё
      и notability (у homebrew-core — звёзды/форки).
- [ ] Подпись: Apple Developer ID для нотаризации macOS (Gatekeeper на бинарь из браузера),
      code signing для Windows (SmartScreen). Оба — деньги, не код.
- [ ] macOS arm64 в режиме `sea` весит 161 МБ против 49 у selfextract — разобраться, почему не
      selfextract и там (`build.yml`, комментарий про #143/#144 касается Intel).
- [ ] Антивирусный скан `diode-windows-x64.exe` (VirusTotal) до первой подачи в winget:
      SEA-сборка — `node.exe` с приклеенным блобом, эвристики такое иногда метят.
