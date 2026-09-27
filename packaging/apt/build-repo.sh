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

if [[ -z "$key" ]]; then
    key="$(gpg --batch --list-secret-keys --with-colons | awk -F: '$1=="sec"{print $5; exit}')"
fi
[[ -n "$key" ]] || { echo "no secret gpg key available" >&2; exit 1; }

gpg --batch --yes --local-user "$key" --clearsign --digest-algo SHA256 -o InRelease Release
gpg --batch --yes --local-user "$key" --detach-sign --armor --digest-algo SHA256 -o Release.gpg Release
gpg --batch --yes --export "$key" > diode-archive-keyring.gpg

echo "apt repo metadata written to $dir (key $key)"
