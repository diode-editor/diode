# packaging — каналы дистрибуции

Единственный источник бинарей — GitHub Releases (`build.yml` → `release.yml`). Всё, что лежит
здесь, либо заворачивает эти бинари в формат канала, либо рендерит манифест, указывающий на них.
Публичное описание каналов для пользователя — [docs/public/INSTALL.md](../docs/public/INSTALL.md);
что сделано, что осталось и какие секреты нужны — [docs/TODO/Distribution.md](../docs/TODO/Distribution.md).

| Канал | Где | Кто дёргает |
|---|---|---|
| `curl \| sh` | [`install.sh`](../install.sh) в корне | пользователь, напрямую из `raw.githubusercontent.com` |
| apt | [`deb/build-deb.sh`](deb/build-deb.sh), [`apt/build-repo.sh`](apt/build-repo.sh), [`apt/gen-key.sh`](apt/gen-key.sh) | job `packages` в `release.yml` |
| npm | [`npm/`](npm/) — пакет `@diode-editor/diode` | job `npm` |
| Homebrew | [`render.mjs`](render.mjs) → `Formula/diode.rb` в `diode-editor/homebrew-tap` | job `brew` |
| winget | [`render.mjs`](render.mjs) → манифесты `DiodeEditor.Diode` | первая подача руками, дальше job `winget` |

## Локальная проверка

```sh
# Установщик — против живого релиза, в свой каталог
DIODE_INSTALL_DIR=/tmp/diode-bin ./install.sh

# .deb + apt-метаданные (нужны dpkg-deb, dpkg-scanpackages, apt-ftparchive, gpg с секретным ключом)
packaging/deb/build-deb.sh dist/diode amd64 0.0.0 /tmp/repo
packaging/apt/build-repo.sh /tmp/repo

# npm-обёртка: собрать tarball и поставить в отдельный prefix
cd packaging/npm && npm version 0.3.0 --no-git-tag-version && npm pack
npm install -g --prefix /tmp/npm-global ./diode-editor-diode-0.3.0.tgz && /tmp/npm-global/bin/diode --version

# Формула и winget-манифесты для уже опубликованного релиза (sha256 берутся из GitHub API)
node packaging/render.mjs --version 0.3.0 --from-github
```

## Первая подача в winget

`wingetcreate update` умеет только обновлять существующий пакет, поэтому первый раз манифесты
уходят руками:

1. `node packaging/render.mjs --version X.Y.Z --from-github --release-date YYYY-MM-DD`
2. В форке `microsoft/winget-pkgs` положить `packaging/out/winget/DiodeEditor.Diode/X.Y.Z/*.yaml`
   в `manifests/d/DiodeEditor/Diode/X.Y.Z/`, проверить `winget validate <папка>`, открыть PR.
3. После мержа — секрет `WINGET_TOKEN` (PAT с `public_repo`), и следующие версии подаёт `release.yml`.

## Ключ apt-репозитория

`packaging/apt/gen-key.sh <dir>` делает ed25519-ключ без пароля. Приватная половина —
в секрет `APT_GPG_PRIVATE_KEY` (и в парольницу: потеря ключа = переустановка keyring у всех
пользователей). Публичная уезжает ассетом `diode-archive-keyring.gpg` в каждый релиз.
