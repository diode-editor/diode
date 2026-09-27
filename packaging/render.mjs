#!/usr/bin/env node
/**
 * Рендерит манифесты пакетных каналов для одного релиза:
 *   - Homebrew cask     → <out>/brew/Casks/diode.rb
 *   - winget-манифесты  → <out>/winget/DiodeEditor.Diode/<version>/*.yaml
 *
 * Источник sha256 — либо каталог с сайдкарами `<asset>.sha256` (так делает release.yml,
 * скачав артефакты сборки), либо GitHub API (поле `digest` у ассетов релиза):
 *
 *   node packaging/render.mjs --version 0.3.0 --sums <dir>   [--out <dir>]
 *   node packaging/render.mjs --version 0.3.0 --from-github  [--out <dir>]
 *
 * Версия — без ведущей `v`. По умолчанию --out = packaging/out.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "diode-editor/diode";
const ASSETS = [
    "diode-linux-x64",
    "diode-linux-arm64",
    "diode-macos-x64",
    "diode-macos-arm64",
    "diode-windows-x64.exe",
];

const args = parseArgs(process.argv.slice(2));
const version = String(args.version ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+/.test(version)) fail("--version X.Y.Z обязателен");
const here = dirname(fileURLToPath(import.meta.url));
const out = args.out ?? join(here, "out");

const sums = args["from-github"] ? await sumsFromGithub(version) : sumsFromDir(args.sums);
for (const asset of ASSETS) if (!sums[asset]) fail(`нет sha256 для ${asset}`);

const url = (asset) => `https://github.com/${REPO}/releases/download/v${version}/${asset}`;

writeOut(join(out, "brew", "Casks", "diode.rb"), renderCask());
const wingetDir = join(out, "winget", "DiodeEditor.Diode", version);
writeOut(join(wingetDir, "DiodeEditor.Diode.yaml"), renderWingetVersion());
writeOut(join(wingetDir, "DiodeEditor.Diode.installer.yaml"), renderWingetInstaller());
writeOut(join(wingetDir, "DiodeEditor.Diode.locale.en-US.yaml"), renderWingetLocale());

// ---------------------------------------------------------------------------

// Cask, а не формула: формулу без бутылки Homebrew считает сборкой из исходников и на
// macOS требует свежие Command Line Tools (formula_installer.rb: `unless pour_bottle?` →
// perform_build_from_source_checks), хотя мы только скачиваем бинарь. Cask — штатный путь
// для готовых бинарей; со стансами `os`/`arch` один cask покрывает macOS и Linux.
function renderCask() {
    return `# Сгенерировано packaging/render.mjs из релиза v${version} — руками не править.
cask "diode" do
  arch arm: "arm64", intel: "x64"
  os macos: "macos", linux: "linux"

  version "${version}"
  sha256 arm:          "${sums["diode-macos-arm64"]}",
         intel:        "${sums["diode-macos-x64"]}",
         arm64_linux:  "${sums["diode-linux-arm64"]}",
         x86_64_linux: "${sums["diode-linux-x64"]}"

  url "https://github.com/${REPO}/releases/download/v#{version}/diode-#{os}-#{arch}"
  name "Diode"
  desc "Terminal text editor with VS Code keys, VS Code extensions and LSP"
  homepage "https://diode-editor.github.io/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Ассет — голый бинарь без архива; в stage он лежит под именем из URL.
  container type: :naked

  binary "diode-#{os}-#{arch}", target: "diode"
end
`;
}

function renderWingetVersion() {
    return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.12.0.schema.json
PackageIdentifier: DiodeEditor.Diode
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.12.0
`;
}

function renderWingetInstaller() {
    return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.12.0.schema.json
PackageIdentifier: DiodeEditor.Diode
PackageVersion: ${version}
InstallerLocale: en-US
InstallerType: portable
Scope: user
UpgradeBehavior: uninstallPrevious
Commands:
  - diode
ReleaseDate: ${args["release-date"] ?? new Date().toISOString().slice(0, 10)}
Installers:
  - Architecture: x64
    InstallerUrl: ${url("diode-windows-x64.exe")}
    InstallerSha256: ${sums["diode-windows-x64.exe"].toUpperCase()}
    PortableCommandAlias: diode
ManifestType: installer
ManifestVersion: 1.12.0
`;
}

function renderWingetLocale() {
    return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.12.0.schema.json
PackageIdentifier: DiodeEditor.Diode
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Diode
PublisherUrl: https://diode-editor.github.io
PublisherSupportUrl: https://github.com/${REPO}/issues
PackageName: Diode
PackageUrl: https://diode-editor.github.io
License: GPL-3.0-or-later
LicenseUrl: https://www.gnu.org/licenses/gpl-3.0.html
ShortDescription: Terminal text editor with VS Code keys, VS Code extensions and LSP
Description: |-
  Diode is a non-modal terminal text editor that keeps the VS Code keyboard layout and runs
  VS Code language extensions outside Electron: over ssh, in containers, anywhere VS Code
  itself does not reach. Single-file binary with the TypeScript language server and ripgrep bundled.
Moniker: diode
Tags:
  - editor
  - terminal
  - tui
  - vscode
  - lsp
ReleaseNotesUrl: https://github.com/${REPO}/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: 1.12.0
`;
}

// ---------------------------------------------------------------------------

function sumsFromDir(dir) {
    if (!dir) fail("нужен --sums <dir> или --from-github");
    const sums = {};
    for (const asset of ASSETS) {
        const file = join(dir, `${asset}.sha256`);
        if (!existsSync(file)) continue;
        sums[asset] = readFileSync(file, "utf8").trim().split(/\s+/)[0].toLowerCase();
    }
    return sums;
}

async function sumsFromGithub(version) {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${version}`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "diode-packaging" },
    });
    if (!response.ok) fail(`GitHub API: ${response.status} для v${version}`);
    const release = await response.json();
    const sums = {};
    for (const asset of release.assets) {
        const digest = String(asset.digest ?? "");
        if (digest.startsWith("sha256:")) sums[asset.name] = digest.slice("sha256:".length).toLowerCase();
    }
    return sums;
}

function writeOut(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
}

function parseArgs(argv) {
    const result = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) fail(`неожиданный аргумент ${arg}`);
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
            result[key] = next;
            i++;
        } else {
            result[key] = true;
        }
    }
    return result;
}

function fail(message) {
    console.error(`render.mjs: ${message}`);
    process.exit(1);
}
