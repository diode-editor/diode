#!/usr/bin/env bash
# Project environment for Diode: only what the repo needs to build and run.
# Personal tools and configs (tmux.conf, shell, editor) do not belong here: they
# come from a dotfiles repo, the same locally and in Codespaces. Do not mix the
# layers, they live on different timescales: the project one is frozen for years,
# the personal one changes every week.
set -euo pipefail

LAZYGIT_VERSION=0.45.2

# The node feature installs it via nvm, and lifecycle commands run in a
# non-interactive shell that does not source /etc/profile.d; without this
# npm below is not found.
export NVM_DIR=/usr/local/share/nvm
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

sudo apt-get update
# tmux is the working shell for the TUI: it keeps long editor sessions with panes next to them.
# ncurses-term is the full terminfo entry; without it TUIs inside tmux render garbled.
# build-essential and python3 are for node-gyp. Node 26 has no prebuilt native
#   modules (node-pty) yet, so they compile from source.
sudo apt-get install -y --no-install-recommends \
	tmux \
	ncurses-term \
	locales \
	curl \
	ca-certificates \
	build-essential \
	python3
sudo locale-gen en_US.UTF-8

# lazygit names its assets x86_64 and arm64, so mapping from uname is required.
# A hardcoded x86_64 in the URL silently installs the amd64 binary on aarch64, and it
# fails with exec format error on the first run.
case "$(uname -m)" in
	x86_64) lazygit_arch=x86_64 ;;
	aarch64) lazygit_arch=arm64 ;;
	*)
		echo "lazygit: no build for $(uname -m), skipping" >&2
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

echo "Diode development environment ready!"
