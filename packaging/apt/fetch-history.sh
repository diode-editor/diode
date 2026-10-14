#!/usr/bin/env bash
# Записи Packages всех прошлых стабильных релизов — чтобы apt видел не только последнюю версию.
#
#   packaging/apt/fetch-history.sh <out-file> [exclude-tag] [owner/repo]
#
# Каждый релиз с v0.4.0 несёт ассет Packages. Из него берётся только станза своей версии
# (Version = тег без `v`), и её голый Filename переписывается в путь до ассета того релиза:
#
#   Filename: ../../download/v0.8.3/diode_0.8.3_amd64.deb
#
# sources.list у пользователя смотрит на releases/latest/download/, а
# releases/latest/download/../../download/vX/… — это releases/download/vX/…. apt склеивает
# base + Filename без нормализации и шлёт `..` как есть, GitHub такой путь принимает.
# Спецификация формата просит Filename без `.`/`..` («should»), строгие зеркалировщики
# могут такие записи отвергнуть — поэтому `..` получают только старые версии, а новая
# (build-repo.sh, dpkg-scanpackages) остаётся с голым именем: в худшем случае строгий
# клиент не увидит истории, но последняя версия ставится как раньше.
#
# Размеры и хэши берутся из старых Packages, сами .deb не качаются. Релизы без Packages
# (до появления apt-ключа) пропускаются. Пересобирается целиком при каждом релизе —
# пропуск в одном релизе чинится следующим.

set -euo pipefail

out="${1:?output file}"
exclude="${2:-}"
repo="${3:-${GITHUB_REPOSITORY:-diode-editor/diode}}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
: > "$out"

# Nightly — pre-release и сюда не попадает, как и в releases/latest.
gh release list -R "$repo" --exclude-pre-releases --exclude-drafts --limit 1000 \
    --json tagName --jq '.[].tagName' |
while read -r tag; do
    [[ "$tag" == "$exclude" ]] && continue
    if ! gh release download "$tag" -R "$repo" -p Packages -O "$tmp" --clobber 2>/dev/null; then
        echo "skip $tag: no Packages asset" >&2
        continue
    fi
    awk -v RS= -v ORS='\n\n' -v ver="${tag#v}" -v tag="$tag" '
        {
            if ($0 !~ ("(^|\n)Version: " ver "(\n|$)")) next
            n = split($0, lines, "\n"); s = ""
            for (i = 1; i <= n; i++) {
                l = lines[i]
                if (l ~ /^Filename: [^\/]+$/) sub(/^Filename: /, "Filename: ../../download/" tag "/", l)
                s = s l (i < n ? "\n" : "")
            }
            print s
        }' "$tmp" >> "$out"
    echo "history: $tag" >&2
done
