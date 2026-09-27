#!/usr/bin/env bash
# Плоский apt-репозиторий поверх GitHub Releases.
#
#   packaging/apt/build-repo.sh <dir with *.deb> [gpg-key-id]
#
# Кладёт рядом с .deb файлы Packages, Packages.gz, Release, InRelease, Release.gpg и
# diode-archive-keyring.gpg. Всё это заливается ассетами в тот же релиз, а у пользователя
# в sources.list:
#
#   deb [signed-by=/etc/apt/keyrings/diode.gpg] https://github.com/diode-editor/diode/releases/latest/download ./
#
# apt запрашивает <base>/InRelease и <base>/Packages, а Filename в Packages — имя .deb
# относительно того же base: GitHub отвечает редиректом на CDN, apt по нему идёт.
# «latest» у GitHub — последний НЕ pre-release, поэтому nightly сюда не попадает.
#
# Ключ: приватный ключ приезжает в CI из секрета APT_GPG_PRIVATE_KEY (armored, без пароля);
# id ключа можно не передавать — возьмётся первый секретный ключ в keyring.

set -euo pipefail

dir="${1:?dir with .deb files}"
key="${2:-}"

cd "$dir"
ls ./*.deb >/dev/null 2>&1 || { echo "no .deb files in $dir" >&2; exit 1; }

# Filename должен быть голым именем файла (без ./): apt склеивает base URL + Filename.
dpkg-scanpackages --multiversion . /dev/null | sed 's|^Filename: \./|Filename: |' > Packages
gzip -9 -k -f Packages

apt-ftparchive \
    -o APT::FTPArchive::Release::Origin=Diode \
    -o APT::FTPArchive::Release::Label=Diode \
    -o APT::FTPArchive::Release::Suite=stable \
    -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
    -o APT::FTPArchive::Release::Description="Diode terminal editor, flat repository on GitHub Releases" \
    release . > Release

# Ключ подписи: первый, у которого секретная часть реально есть (поле 15 ≠ "#") и
# среди возможностей есть подпись (поле 12 содержит "s"). Так работает и отдельный
# ключ (gen-key.sh), и экспортированный сам по себе подписывающий субключ личного
# ключа (`gpg --export-secret-subkeys <subkey>!`): у последнего primary в keyring
# помечен как отсутствующий, и `--local-user <primary>` упал бы.
if [[ -z "$key" ]]; then
    key="$(gpg --batch --list-secret-keys --with-colons \
        | awk -F: '($1=="sec" || $1=="ssb") && $15!="#" && $12 ~ /s/ {print $5; exit}')"
fi
[[ -n "$key" ]] || { echo "no secret gpg key with signing capability available" >&2; exit 1; }

# Пароль ключа (если есть) — из APT_GPG_PASSPHRASE; иначе ключ должен быть без пароля.
sign=(gpg --batch --yes --local-user "${key}!" --digest-algo SHA256)
if [[ -n "${APT_GPG_PASSPHRASE:-}" ]]; then
    sign+=(--pinentry-mode loopback --passphrase-fd 3)
    exec 3< <(printf '%s' "$APT_GPG_PASSPHRASE")
fi

"${sign[@]}" --clearsign -o InRelease Release
if [[ -n "${APT_GPG_PASSPHRASE:-}" ]]; then exec 3< <(printf '%s' "$APT_GPG_PASSPHRASE"); fi
"${sign[@]}" --detach-sign --armor -o Release.gpg Release
gpg --batch --yes --export "$key" > diode-archive-keyring.gpg

echo "apt repo metadata written to $dir (key $key)"
