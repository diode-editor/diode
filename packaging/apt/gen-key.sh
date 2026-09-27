#!/usr/bin/env bash
# Одноразово: ключ подписи apt-репозитория.
#
#   packaging/apt/gen-key.sh <out-dir>
#
# Генерирует ed25519-ключ без пароля в отдельном временном keyring, кладёт в <out-dir>:
#   apt-signing-key.private.asc — в секрет репозитория APT_GPG_PRIVATE_KEY (и в парольницу)
#   apt-signing-key.public.asc  — публичная половина, для справки
#
# Ключ не имеет срока действия. Ротация = новый ключ в секрете + новый keyring в релизе;
# пользователи переустанавливают /etc/apt/keyrings/diode.gpg.

set -euo pipefail

out="${1:?output dir}"
mkdir -p "$out"

home="$(mktemp -d)"
trap 'rm -rf "$home"' EXIT
chmod 700 "$home"

gpg --homedir "$home" --batch --quiet --gen-key <<PARAMS
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: sign
Name-Real: Diode apt repository
Name-Email: noreply@diode-editor.github.io
Expire-Date: 0
%commit
PARAMS

gpg --homedir "$home" --batch --armor --export-secret-keys > "$out/apt-signing-key.private.asc"
gpg --homedir "$home" --batch --armor --export > "$out/apt-signing-key.public.asc"
chmod 600 "$out/apt-signing-key.private.asc"

echo "Private key: $out/apt-signing-key.private.asc  → gh secret set APT_GPG_PRIVATE_KEY < этот файл"
echo "Public key:  $out/apt-signing-key.public.asc"
