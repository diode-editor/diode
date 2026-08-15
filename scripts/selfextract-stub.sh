#!/bin/sh
# diode — self-extracting executable.
#
# Этот файл = стаб + приклеенный следом payload.tar.gz (node + main.js + diode.bundle).
# Собирается `scripts/build-selfextract.mjs`; плейсхолдеры @@…@@ подставляются там же.
# Правя стаб, помни: его длина в байтах и есть offset payload'а, т.е. OFFSET зависит
# от текста вокруг себя (build-скрипт решает это итерацией). Ведущих нулей у OFFSET
# быть не должно: BSD tail на macOS прочитает такое число как восьмеричное.
#
# Зачем это вместо Node SEA: инъекция SEA-блоба портит Mach-O chained fixups на
# Intel macOS → segfault до main() (см. #143, #144). Здесь node остаётся нетронутым
# бинарём с nodejs.org, никакой хирургии над Mach-O — и баг не воспроизводится.
set -eu

OFFSET=@@OFFSET@@
KEY=@@KEY@@

CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/diode"
DIR="$CACHE_ROOT/$KEY"

# Распаковка идемпотентна и версионирована: KEY = <version>-<sha payload'а>, поэтому
# новая сборка = новый каталог, а не перезапись живого. Маркер .ready ставится ДО
# публикации каталога, так что полураспакованное состояние снаружи ненаблюдаемо.
if [ ! -f "$DIR/.ready" ]; then
    mkdir -p "$CACHE_ROOT"

    # mkdir атомарен — это и есть мьютекс. Наивное `[ -d "$DIR" ] || mv "$TMP" "$DIR"`
    # не годится: mv в СУЩЕСТВУЮЩИЙ каталог вкладывает его внутрь, а не падает.
    if mkdir "$DIR.lock" 2>/dev/null; then
        TMP=$(mktemp -d "$CACHE_ROOT/.tmp-XXXXXX")
        trap 'rm -rf "$TMP" "$DIR.lock"' EXIT INT TERM

        # $0 читаем до любого cd: ядро передаёт sh путь, использованный в execve,
        # поэтому запуск через PATH тоже работает.
        tail -c "+$OFFSET" "$0" | tar -xzf - -C "$TMP"
        : > "$TMP/.ready"

        rm -rf "$DIR"          # под локом: гарантируем, что цель rename не существует
        mv "$TMP" "$DIR"       # rename(2) на несуществующий путь — атомарен

        trap - EXIT INT TERM
        rm -rf "$DIR.lock"
    else
        # Кто-то распаковывает прямо сейчас — ждём его .ready.
        i=0
        while [ ! -f "$DIR/.ready" ] && [ "$i" -lt 300 ]; do
            sleep 0.1
            i=$((i + 1))
        done
        if [ ! -f "$DIR/.ready" ]; then
            echo "diode: timed out waiting for unpack." >&2
            echo "diode: if no other diode is starting, remove the stale lock: rm -rf '$DIR.lock'" >&2
            exit 1
        fi
    fi
fi

# exec заменяет образ процесса — argv, код возврата и сигналы прокидываются ядром
# без прослойки, никакого babysitting'а дочернего процесса не требуется.
exec "$DIR/node" "$DIR/main.js" "$@"
