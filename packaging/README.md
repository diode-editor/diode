# packaging — каналы дистрибуции

Единственный источник бинарей — GitHub Releases (`build.yml` → `release.yml`). Всё, что лежит
здесь, либо заворачивает эти бинари в формат канала, либо рендерит манифест, указывающий на них.
Публичное описание каналов для пользователя — [docs/public/INSTALL.md](../docs/public/INSTALL.md);
что сделано, что осталось и какие секреты нужны — [docs/TODO/Distribution.md](../docs/TODO/Distribution.md).

| Канал | Где | Кто дёргает |
|---|---|---|
| `curl \| sh` | [`install.sh`](../install.sh) в корне: `--method=binary` (по умолчанию) \| `apt` \| `brew` \| `npm`, как у fresh | пользователь, напрямую из `raw.githubusercontent.com` |
| apt | [`deb/build-deb.sh`](deb/build-deb.sh), [`apt/build-repo.sh`](apt/build-repo.sh), [`apt/gen-key.sh`](apt/gen-key.sh) | job `packages` в `release.yml` |
| npm | [`npm/`](npm/) — пакет `@diode-editor/diode` | job `npm` |
| Homebrew | [`render.mjs`](render.mjs) → `Casks/diode.rb` в `diode-editor/homebrew-tap` (cask, не формула: формула без бутылки требует CLT на macOS) | job `brew` |
| winget | [`render.mjs`](render.mjs) → манифесты `DiodeEditor.Diode` | первая подача руками, дальше job `winget` |

## Локальная проверка

```sh
# Установщик — против живого релиза, в свой каталог; методы apt/brew/npm ставят по-настоящему
DIODE_INSTALL_DIR=/tmp/diode-bin ./install.sh
./install.sh --method=apt      # sudo: keyring + sources.list.d + apt-get install
./install.sh --method=brew
npm_config_prefix=/tmp/npm-global ./install.sh --method=npm

# .deb + apt-метаданные (нужны dpkg-deb, dpkg-scanpackages, apt-ftparchive, gpg с секретным ключом)
packaging/deb/build-deb.sh dist/diode amd64 0.0.0 /tmp/repo
packaging/apt/build-repo.sh /tmp/repo

# npm-обёртка: собрать tarball и поставить в отдельный prefix
cd packaging/npm && npm version 0.3.0 --no-git-tag-version && npm pack
npm install -g --prefix /tmp/npm-global ./diode-editor-diode-0.3.0.tgz && /tmp/npm-global/bin/diode --version

# Формула и winget-манифесты для уже опубликованного релиза (sha256 берутся из GitHub API)
node packaging/render.mjs --version 0.3.0 --from-github
```

## npm: первая публикация и Trusted Publisher

`release.yml` публикует через npm Trusted Publishing (OIDC): секрета нет, provenance ставится
автоматически. Но Trusted Publisher настраивается на странице уже существующего пакета, поэтому
первую версию публикует человек с правами в организации `diode-editor` на npm:

```sh
cd packaging/npm
npm login
npm version X.Y.Z --no-git-tag-version     # версия = уже вышедший тег vX.Y.Z (бинарь качается из него)
npm publish --access public
git checkout package.json                  # в репозитории версия остаётся 0.0.0
```

Затем на npmjs.com → пакет `@diode-editor/diode` → Settings → Trusted Publisher → GitHub Actions:
organization `diode-editor`, repository `diode`, workflow filename `release.yml`, environment
пустой. После этого следующие версии публикует джоба `npm` сама.

## Первая подача в winget

`wingetcreate update` умеет только обновлять существующий пакет, поэтому первый раз манифесты
уходят руками:

1. `node packaging/render.mjs --version X.Y.Z --from-github --release-date YYYY-MM-DD`
2. В форке `microsoft/winget-pkgs` положить `packaging/out/winget/DiodeEditor.Diode/X.Y.Z/*.yaml`
   в `manifests/d/DiodeEditor/Diode/X.Y.Z/`, проверить `winget validate <папка>`, открыть PR.
3. После мержа — секрет `WINGET_TOKEN` (PAT с `public_repo`), и следующие версии подаёт `release.yml`.

## Ключ apt-репозитория

`packaging/apt/gen-key.sh [dir]` делает ed25519-ключ «только подпись, без срока» в вашем
keyring (пароль спрашивает pinentry), экспортирует обе половины в `dir` (по умолчанию
`~/diode-apt-key`) и печатает base64 приватной половины одной строкой — это значение секрета
`APT_GPG_PRIVATE_KEY`; пароль ключа — секрет `APT_GPG_PASSPHRASE`. Обе строки — в парольницу:
потеря ключа = переустановка keyring у всех пользователей apt. Публичная половина уезжает
ассетом `diode-archive-keyring.gpg` в каждый релиз из keyring CI.

`build-repo.sh` сам находит первый секретный ключ с правом подписи (годится и отдельно
экспортированный подписывающий субключ) и берёт пароль из `APT_GPG_PASSPHRASE`.
