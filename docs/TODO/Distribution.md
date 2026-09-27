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
- [x] `install.sh --method=apt|brew|npm` (как у fresh, `sh -s -- --method=…` после пайпа): apt ставит
      keyring и `sources.list.d`, обновляет только свой список и ставит пакет; после binary-установки
      на Debian-подобных подсказывает `--method=apt`. Все четыре метода прогнаны в контейнере на v0.4.0.
- [x] apt — `.deb` через `dpkg-deb` (без nfpm), плоский репозиторий ассетами релиза, подпись GPG.
      Цепочка `apt update` → `InRelease` по `signed-by` → `Packages.gz` → `.deb` проверена локально
      через сервер с 302-редиректами как у GitHub; GitHub принимает путь `/./InRelease`, который шлёт apt.
- [x] npm — `@diode-editor/diode`, тонкая обёртка с докачкой бинаря и sha256; `npx` работает.
      Проверено: `npm pack` → `npm install -g --prefix` → `diode --version` = 0.3.0.
- [x] Homebrew — **cask** (не формула) со стансами `os`/`arch`, один на macOS и Linux, рендерится из
      sha256. Формулу без бутылки Homebrew считает сборкой из исходников и на macOS требует свежие
      Command Line Tools — на этом упала первая живая установка v0.4.0 на macOS 14.
- [x] winget — три манифеста `DiodeEditor.Diode`, `InstallerType: portable`.
- [x] `release.yml` — jobs `packages`, `npm`, `brew`, `winget`; каждая молча пропускается без своего секрета.
- [x] `README.md` — quick install первым, ниже команды остальных каналов; детали на INSTALL.md.

## Чтобы заработало (руками, один раз)

- [x] `packaging/apt/gen-key.sh` → секреты `APT_GPG_PRIVATE_KEY` (base64 armored-ключа, печатает
      скрипт) и `APT_GPG_PASSPHRASE` заведены 2026-09-27; ключ и пароль — в парольнице владельца.
      Путь ключа проверен локально: генерация с паролем → base64 → импорт «в CI» → подпись →
      проверка опубликованным keyring.
- [x] `@diode-editor/diode@0.3.0` опубликован руками 2026-09-27, `npx` с чистого кэша работает.
- [x] Trusted Publisher (GitHub Actions, `release.yml`) настроен: v0.4.0 опубликован джобой `npm`
      без токена, у версии есть SLSA-provenance (`dist.attestations`).
- [x] Репозиторий `diode-editor/homebrew-tap` создан (2026-09-27); формула заменена cask'ом.
- [x] `REPOSITORY_PAT` имеет push в `homebrew-tap`: джоба `brew` релиза v0.4.0 обновила формулу
      сама. (Если токен когда-нибудь меняется: classic со scope `repo` покрывает все репозитории
      организации, fine-grained — только перечисленные в «Repository access» с Contents: read and write.)
- [~] Первая подача в winget: PR [microsoft/winget-pkgs#442141](https://github.com/microsoft/winget-pkgs/pull/442141)
      (2026-09-27, ветка `DiodeEditor.Diode-0.3.0` в форке `tihonove/winget-pkgs`, коммит через
      Git Data API — клон с `tree:0` при push дотягивает всё дерево). После мержа — секрет
      `WINGET_TOKEN` (PAT с `public_repo`), дальше версии подаёт `release.yml`.
- [x] v0.4.0 (2026-09-27) — первый релиз со всеми каналами: все джобы `release.yml` зелёные, в ассетах
      сайдкары, `diode_0.4.0_{amd64,arm64}.deb`, `Packages`/`InRelease`/`Release.gpg`,
      `diode-archive-keyring.gpg`.
- [x] Проверено на живом релизе: `install.sh` с raw main → `sha256 OK`, `diode 0.4.0`;
      `apt-get update` → `InRelease` по `signed-by` с GitHub, `policy` → 0.4.0, `download` → 49.8 МБ
      за 3 с; `npx @diode-editor/diode --version` с чистого кэша → 0.4.0; тап обновлён на v0.4.0.
- [x] `brew install diode-editor/tap/diode` на macOS 14 (Intel): первая попытка упала на формуле
      (CLT), после замены на cask переустановка прошла (2026-09-27, сторонняя машина).
- [ ] Не проверено руками: `winget install DiodeEditor.Diode` (после мержа PR) — нужна Windows.
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
- [x] Антивирусный скан SEA-сборки: пайплайн winget-pkgs (несколько антивирусов + Windows Sandbox)
      прошёл на v0.3.0 (`Validation-Completed`), опасение снято.
