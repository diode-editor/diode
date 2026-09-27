#!/usr/bin/env bash
# Одноразово: ключ подписи apt-репозитория.
#
#   packaging/apt/gen-key.sh [out-dir]          (по умолчанию ~/diode-apt-key)
#
# 1. Генерирует ed25519-ключ «только подпись, без срока действия» в ТЕКУЩЕМ keyring
#    ($GNUPGHOME или ~/.gnupg) — он остаётся там как резерв. Пароль спрашивает pinentry.
# 2. Экспортирует в <out-dir>:
#      apt-signing-key.private.asc — приватная половина (armored), chmod 600
#      apt-signing-key.public.asc  — публичная, для справки (в релиз она уедет из CI сама)
# 3. Печатает base64 приватной половины одной строкой — это значение секрета
#    APT_GPG_PRIVATE_KEY (release.yml декодирует его обратно). Пароль ключа —
#    отдельный секрет APT_GPG_PASSPHRASE.
#
# Срок действия не ставим намеренно: apt отказывает в `update` по истёкшему ключу,
# а обновить keyring у всех пользователей нельзя. Потеря ключа = новый keyring у всех,
# поэтому base64 и пароль — в парольницу.
#
# Неинтерактивный режим (тесты): DIODE_KEY_PASSPHRASE=<пароль> — без pinentry.

set -euo pipefail

out="${1:-$HOME/diode-apt-key}"
uid="Diode apt repository <noreply@diode-editor.github.io>"

if gpg --batch --list-secret-keys "$uid" >/dev/null 2>&1; then
    echo "gen-key.sh: ключ «$uid» уже есть в keyring — экспортирую его, новый не создаю" >&2
else
    if [[ -n "${DIODE_KEY_PASSPHRASE:-}" ]]; then
        gpg --batch --quiet --pinentry-mode loopback --passphrase "$DIODE_KEY_PASSPHRASE" \
            --quick-gen-key "$uid" ed25519 sign 0
    else
        gpg --quiet --quick-gen-key "$uid" ed25519 sign 0
    fi
fi

mkdir -p "$out"
chmod 700 "$out"
if [[ -n "${DIODE_KEY_PASSPHRASE:-}" ]]; then
    gpg --batch --pinentry-mode loopback --passphrase "$DIODE_KEY_PASSPHRASE" \
        --armor --export-secret-keys "$uid" > "$out/apt-signing-key.private.asc"
else
    gpg --armor --export-secret-keys "$uid" > "$out/apt-signing-key.private.asc"
fi
chmod 600 "$out/apt-signing-key.private.asc"
gpg --batch --armor --export "$uid" > "$out/apt-signing-key.public.asc"

fpr="$(gpg --batch --list-keys --with-colons "$uid" | awk -F: '$1=="fpr"{print $10; exit}')"

{
    echo "Ключ:        $fpr"
    echo "Приватный:   $out/apt-signing-key.private.asc"
    echo "Публичный:   $out/apt-signing-key.public.asc"
    echo
    echo "Секреты репозитория:"
    echo "  gh secret set APT_GPG_PRIVATE_KEY --repo diode-editor/diode < $out/apt-signing-key.private.b64"
    echo "  gh secret set APT_GPG_PASSPHRASE  --repo diode-editor/diode   # спросит пароль"
    echo
    echo "APT_GPG_PRIVATE_KEY (base64, одной строкой; также записан в $out/apt-signing-key.private.b64):"
} >&2

base64 < "$out/apt-signing-key.private.asc" | tr -d '\n' > "$out/apt-signing-key.private.b64"
chmod 600 "$out/apt-signing-key.private.b64"
cat "$out/apt-signing-key.private.b64"
echo
