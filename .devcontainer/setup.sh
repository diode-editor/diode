#!/usr/bin/env bash
# Проектное окружение Vexx: только то, без чего репозиторий не собирается и не
# работает. Личные инструменты и конфиги (tmux.conf, шелл, редактор) сюда не
# попадают — они приезжают из dotfiles-репозитория, одинаково локально и в
# Codespaces. Смешивать слои нельзя: у них разный срок жизни, проектный
# замораживается на годы, личный меняется каждую неделю.
set -euo pipefail

LAZYGIT_VERSION=0.45.2

# Фича node ставит его через nvm, а lifecycle-команды выполняются в
# неинтерактивном шелле, где /etc/profile.d не подхватывается — без этого
# npm ниже просто не найдётся.
export NVM_DIR=/usr/local/share/nvm
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

sudo apt-get update
# tmux — не удобство, а зависимость agents.sh: там агент это буквально окно tmux,
#   потому что ни cron, ни systemd в devcontainer недоступны.
# ncurses-term — полная terminfo-запись; без неё TUI внутри tmux разъезжаются.
# build-essential и python3 — node-gyp. Под node 25 готовых сборок нативных
#   модулей (node-pty) ещё нет, они компилируются из исходников.
sudo apt-get install -y --no-install-recommends \
	tmux \
	ncurses-term \
	locales \
	curl \
	ca-certificates \
	build-essential \
	python3
sudo locale-gen en_US.UTF-8

# lazygit называет ассеты x86_64 и arm64 — сопоставление с uname обязательно.
# Захардкоженный x86_64 в URL молча ставит amd64-бинарник на aarch64, и он
# падает с exec format error уже при первом запуске.
case "$(uname -m)" in
	x86_64) lazygit_arch=x86_64 ;;
	aarch64) lazygit_arch=arm64 ;;
	*)
		echo "lazygit: нет сборки под $(uname -m), пропускаю" >&2
		lazygit_arch=
		;;
esac

if [ -n "$lazygit_arch" ]; then
	tmp=$(mktemp -d)
	curl -fsSL -o "$tmp/lazygit.tar.gz" \
		"https://github.com/jesseduffield/lazygit/releases/download/v${LAZYGIT_VERSION}/lazygit_${LAZYGIT_VERSION}_Linux_${lazygit_arch}.tar.gz"
	tar -xf "$tmp/lazygit.tar.gz" -C "$tmp" lazygit
	sudo install "$tmp/lazygit" /usr/local/bin/
	rm -rf "$tmp"
fi

npm install

echo "Vexx development environment ready!"
