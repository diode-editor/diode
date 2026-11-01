import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    ensureEslintLibrary,
    ESLINT_FLAT_CONFIG,
    LINT_JS,
    linkEslintLibrary,
} from "../../src/TestUtils/eslintFixture.ts";
import {
    ensureGopls,
    GO_SAMPLE_DIR,
    GO_SESSION_ENV,
    goToolchainMissing,
} from "../../src/TestUtils/goFixture.ts";
import { APP_JAVA, APP_JAVA_PATH, POM_XML } from "../../src/TestUtils/javaFixture.ts";
import { startHeadlessApp } from "../helpers/appSession.ts";
import { CLAUDE_CODE_ID, claudeCodeSessionEnv, IdeProbe, waitForIdeLock } from "../helpers/claudeIde.ts";
import { waitForEslintDiagnostics } from "../helpers/eslintReady.ts";
import { findNode } from "../helpers/inspectorClient.ts";
import { waitUntil } from "../helpers/waitFor.ts";

/**
 * A check exercises the extension's real functionality and inspects editor state, not the mere fact
 * of loading (lesson #194/#195). The table is incomplete by design: a missing check blocks nothing,
 * the marketplace decides the lineup.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "fixtures");

export interface ICheckContext {
    /** Session root; the extension is already installed from the registry into `<root>/user-data-dir`. */
    readonly root: string;
}

export interface IMarketplaceCheck {
    readonly id: string;
    /** Paths inside the installed extension's directory that must exist. */
    readonly expectFiles: readonly string[];
    /** Case timeout when the default is too short (language server cold start). */
    readonly timeoutMs?: number;
    /**
     * Skip reason when an external tool is missing (Go toolchain for `golang.go`), like scenario
     * `requires`: CI installs the tool in the job, locally the case is honestly skipped without it.
     */
    requires?(): string | undefined;
    run(ctx: ICheckContext): Promise<void>;
}

/** The effect is read via the inspector, with no PTY input, so the check works on all platforms. */
async function expectTabSize(ctx: ICheckContext, file: string, tabSize: number): Promise<void> {
    const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
    try {
        await app.session.waitForDocument(
            (root) => findNode(root, (n) => n.type === "EditorElement")?.state?.tabSize === tabSize,
            { timeoutMs: 40_000 },
        );
    } finally {
        await app.dispose();
    }
}

export const MARKETPLACE_CHECKS: readonly IMarketplaceCheck[] = [
    {
        // kind: "native", declarative: only a language and grammar contribution, no extension host
        // is started for it at all. Source and packager live in the sibling `sample-extension/`.
        id: "test.sample-lang",
        expectFiles: ["package.json", "syntaxes/diodesample.tmGrammar.json"],
        run: async (ctx) => {
            // The observable effect of the language contribution is the language name in the
            // status bar: a `.diodesample` file is no longer Plain Text.
            const file = join(ctx.root, "sample.diodesample");
            writeFileSync(file, "sample marketplace 42\n# comment\n");
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                await app.session.waitForText((text) => text.includes("Diode Sample"), { timeoutMs: 40_000 });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "native", runtime extension: `main` + subprocess extension host.
        id: "test.tab-setter",
        expectFiles: ["package.json", "extension.js"],
        run: async (ctx) => {
            // On activation the extension sets tabSize=7 on the active editor via
            // `vscode.window.activeTextEditor.options`, so this covers both the
            // subprocess extension host and the RPC to it.
            await expectTabSize(ctx, join(FIXTURES, "tabbed.txt"), 7);
        },
    },
    {
        // kind: "proxy-openvsx": a third-party .vsix downloaded from open-vsx by the URL in the metadata.
        id: "EditorConfig.EditorConfig",
        expectFiles: ["package.json", "out/editorConfigMain.js", "node_modules/editorconfig/lib/index.js"],
        run: async (ctx) => {
            // `[*.tabbed] indent_size = 3` from the project's .editorconfig; the project is copied into
            // the session root so the run doesn't depend on the repository's .editorconfig.
            const project = join(ctx.root, "editorconfig-project");
            cpSync(join(FIXTURES, "editorconfig", "project"), project, { recursive: true });
            await expectTabSize(ctx, join(project, "indent.tabbed"), 3);
        },
    },
    {
        // kind: "proxy-openvsx": the real basedpyright. Activation relies on the curated default
        // `basedpyright.importStrategy: "useBundled"` (`curatedConfigInjection`): the manifest's
        // `fromEnvironment` calls the ms-python.python API and crashes activate().
        id: "detachhead.basedpyright",
        expectFiles: [
            "package.json",
            "dist/extension.js",
            "dist/server.js",
            "dist/typeshed-fallback/stdlib/builtins.pyi",
        ],
        // The bundled server's cold start takes tens of seconds on top of downloading
        // the 6.4 MB artifact: the default 240 s barely suffices.
        timeoutMs: 420_000,
        run: async (ctx) => {
            // Type error → undercurl (StyleFlags.Undercurl === 8), the readiness signal of our LSP e2e.
            const file = join(ctx.root, "typed.py");
            writeFileSync(file, 'reply: int = "hi"\nprint(reply)\n');
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
                    { describe: "undercurl squiggle from basedpyright", timeoutMs: 180_000, intervalMs: 500 },
                );
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx", PLATFORM-SPECIFIC vsix: the real ruff. Proves the whole platform route:
        // machine `targetPlatform` → its artifact → unpacking with the exec bit → spawning the native
        // `ruff server` → diagnostics in the frame. Plus the curated `ruff.importStrategy: "useBundled"`.
        id: "charliermarsh.ruff",
        expectFiles: ["package.json", "dist/extension.js", "bundled/libs/bin/ruff"],
        timeoutMs: 420_000,
        run: async (ctx) => {
            // Unused import → F401 from the default rule set → undercurl.
            const file = join(ctx.root, "lint.py");
            writeFileSync(file, "import sys\n\nprint(1)\n");
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
                    { describe: "undercurl squiggle from ruff", timeoutMs: 180_000, intervalMs: 500 },
                );
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx", platform-specific vsix with a bundled `terraform-ls`. Full activation
        // (TreeItem, context.extension, createTelemetryLogger, authentication: without any of them the
        // server didn't start) up to diagnostics in the frame. Provider schemas are bundled: no terraform
        // CLI needed.
        id: "hashicorp.terraform",
        expectFiles: ["package.json", "dist/extension.js", "bin/terraform-ls"],
        timeoutMs: 420_000,
        run: async (ctx) => {
            // Extra resource attribute → "Unexpected attribute" from the server →
            // undercurl (StyleFlags.Undercurl === 8).
            const file = join(ctx.root, "main.tf");
            writeFileSync(file, 'resource "aws_instance" "web" {\n  bogus_attr = 1\n}\n');
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
                    { describe: "undercurl squiggle from terraform-ls", timeoutMs: 180_000, intervalMs: 500 },
                );
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx": rg from `env.appRoot` scans the workspace, the tags reach the TODOS tree.
        // 0.0.215's highlight timer throws (`ThemeColor` without `new`) — the extension host must survive it.
        id: "Gruntfuggly.todo-tree",
        expectFiles: ["package.json", "dist/extension.js", "resources/todo-tree-container.svg"],
        run: async (ctx) => {
            const file = join(ctx.root, "a.ts");
            writeFileSync(file, "// TODO: first\nconst a = 1;\n// FIXME: broken\n");
            const app = await startHeadlessApp({
                root: ctx.root,
                keepRoot: true,
                open: [ctx.root, file],
                // Nodes start collapsed; the setting expands them as the user would.
                settings: { "todo-tree.tree.expanded": true },
            });
            try {
                await app.session.waitForText((t) => t.includes("// FIXME: broken"), { timeoutMs: 40_000 });
                await app.session.executeCommand("workbench.view.extension.todo-tree-container");
                await app.session.waitForText((t) => t.includes("TODO : first") && t.includes("FIXME : broken"), {
                    timeoutMs: 60_000,
                });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx": the stock Catppuccin theme (`contributes.themes`, inline tokenColors,
        // colors with alpha): `workbench.colorTheme` → the very first frame is themed (background =
        // `editor.background` from themes/mocha.json) and the theme is in the picker. The extension's
        // runtime part is unused.
        id: "Catppuccin.catppuccin-vsc",
        expectFiles: ["package.json", "themes/mocha.json", "themes/latte.json"],
        run: async (ctx) => {
            const file = join(ctx.root, "themed.ts");
            writeFileSync(file, "const answer = 42;\n// mocha\n");
            const app = await startHeadlessApp({
                root: ctx.root,
                keepRoot: true,
                open: [file],
                settings: { "workbench.colorTheme": "Catppuccin Mocha" },
                // The headless DSL can't encode a real Ctrl+K Ctrl+T, so the picker is bound to F8.
                keybindings: [{ key: "f8", command: "workbench.action.selectTheme" }],
            });
            try {
                const frame = await app.session.waitForText((t) => t.includes("const answer"), { timeoutMs: 40_000 });
                const editor = findNode((await app.session.getDocument()).root, (n) => n.type === "EditorElement");
                if (editor === null) throw new Error("EditorElement not found in the tree");
                // Second line, near the right edge: the first is under the cursor and occurrence highlight.
                const cell = frame.cells[(editor.box.y + 1) * frame.cols + editor.box.x + editor.box.width - 2];
                if (cell.bg !== 0x1e1e2e) {
                    throw new Error(
                        `editor background #${cell.bg.toString(16)} is not Catppuccin Mocha editor.background (#1e1e2e)`,
                    );
                }
                await app.session.sendKey("F8");
                await app.session.waitForText((t) => t.includes("Select Color Theme"), { timeoutMs: 20_000 });
                await app.session.sendText("Catppuccin");
                await app.session.waitForText((t) => t.includes("Catppuccin Mocha") && t.includes("Catppuccin Latte"), {
                    timeoutMs: 20_000,
                });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx": the stock ESLint. It does NOT bundle the eslint library, so we supply it
        // as a symlink from the fixture's npm cache. We wait for eslintServer diagnostics, not undercurl:
        // the builtin TS client lints .js too, and the check would be falsely green (e2e/helpers/eslintReady.ts).
        id: "dbaeumer.vscode-eslint",
        expectFiles: ["package.json", "client/out/extension.js", "server/out/eslintServer.js"],
        timeoutMs: 420_000,
        run: async (ctx) => {
            writeFileSync(join(ctx.root, "eslint.config.mjs"), ESLINT_FLAT_CONFIG);
            const file = join(ctx.root, "lint.js");
            writeFileSync(file, LINT_JS);
            linkEslintLibrary(ctx.root, ensureEslintLibrary());
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                await waitForEslintDiagnostics({
                    key: (name) => app.session.sendKey(name),
                    text: (value) => app.session.sendText(value),
                    waitForText: (predicate, opts) => app.session.waitForText(predicate, opts),
                });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx": the stock redhat.java. The undercurl under `int broken = message;` appears
        // only if jdt.ls started, imported and built the project; it also checks the curated lombokSupport
        // (the manifest's `true` would yield "Internal compiler error").
        // `expectFiles` lists only paths shared by the platform-specific and universal artifacts: which one
        // resolution returns depends on the client version.
        id: "redhat.java",
        expectFiles: ["package.json", "dist/extension.js", "server/config_linux/config.ini"],
        timeoutMs: 600_000,
        run: async (ctx) => {
            // The project lives in a SUBDIRECTORY: the root holds `user-data-dir/` with the extension's
            // eclipse state, and jdt.ls silently falls back to "non-project file, only syntax errors".
            const projectRoot = join(ctx.root, "javaproj");
            const file = join(projectRoot, APP_JAVA_PATH);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(join(projectRoot, "pom.xml"), POM_XML);
            writeFileSync(file, APP_JAVA);
            const app = await startHeadlessApp({
                root: ctx.root,
                keepRoot: true,
                // Folder FIRST: redhat.java only has `workspaceContains:` activation events.
                open: [projectRoot, file],
                // Otherwise the telemetry toast covers the right part of the editor
                // (exactly the lines where the squiggle is drawn) and the check races.
                settings: { "redhat.telemetry.enabled": false },
            });
            try {
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
                    { describe: "undercurl squiggle from jdt.ls", timeoutMs: 420_000, intervalMs: 1000 },
                );
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx": the stock golang.go. The undercurl appears only if its languageclient
        // started gopls (diode has no Go client of its own). gopls isn't in the vsix, so GOBIN gets the
        // one built by the fixture (in CI, .github/actions/go-tools); auto-install is covered by
        // goLsp.test.ts. Without a Go toolchain the extension doesn't activate in VS Code either, so the
        // case is skipped.
        id: "golang.go",
        expectFiles: ["package.json", "dist/goMain.js"],
        requires: goToolchainMissing,
        // The first local run builds gopls inside the case (`ensureGopls`).
        timeoutMs: 600_000,
        run: async (ctx) => {
            const gobin = dirname(ensureGopls());
            // The module lives in a subdirectory: the session root holds user-data-dir.
            const projectRoot = join(ctx.root, "goproj");
            cpSync(GO_SAMPLE_DIR, projectRoot, { recursive: true });
            const app = await startHeadlessApp({
                root: ctx.root,
                keepRoot: true,
                open: [projectRoot, join(projectRoot, "main.go")],
                env: { ...GO_SESSION_ENV, GOBIN: gobin },
            });
            try {
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
                    { describe: "undercurl squiggle from gopls", timeoutMs: 300_000, intervalMs: 500 },
                );
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx": prettier, the ONLY ESM extension in the marketplace. Covers markdown
        // formatting (none of our LSPs does) and loading an ESM entry point under SEA, where a direct
        // `import()` from the embedded main doesn't work. The Ctrl+K Ctrl+E chord is sent via the
        // inspector, like the neighboring checks.
        id: "esbenp.prettier-vscode",
        expectFiles: ["package.json", "dist/extension.js", "node_modules/prettier/package.json"],
        timeoutMs: 300_000,
        run: async (ctx) => {
            const file = join(ctx.root, "notes.md");
            writeFileSync(file, "#   Hello\n\n*  item one\n");
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                // The status bar item appears at the end of activate(): the formatting
                // providers are registered by then.
                await app.session.waitForText((text) => text.includes("Prettier"), { timeoutMs: 120_000 });
                await app.session.key("Ctrl+K");
                await app.session.key("Ctrl+E");
                // This text wasn't in the file: it can only come from edits by
                // the real prettier.
                await app.session.waitForText((text) => text.includes("# Hello") && text.includes("- item one"), {
                    timeoutMs: 60_000,
                });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx": the stock Auto Close Tag answers each typed `>` from
        // `onDidChangeTextDocument` with `editor.edit` and `editor.selection =`. It reads `event.reason` to
        // leave undo alone: without it, restoring a deleted `>` closes the tag a second time.
        id: "formulahendry.auto-close-tag",
        expectFiles: ["package.json", "out/src/extension.js"],
        run: async (ctx) => {
            const file = join(ctx.root, "page.xml");
            writeFileSync(file, "");
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                // Awaits activation, and in an empty document there is nothing to close.
                await app.session.executeCommand("auto-close-tag.closeTag");
                // `sendText` is a paste; the extension answers only a `>` typed on its own.
                await app.session.sendText("<p");
                await app.session.key(">");
                await app.session.waitForText((text) => text.includes("<p></p>"), { timeoutMs: 40_000 });
                // The caret stayed between the tags.
                await app.session.sendText("abc");
                await app.session.waitForText((text) => text.includes("<p>abc</p>"), { timeoutMs: 20_000 });
                await app.session.key("Home");
                await app.session.key("ArrowRight");
                await app.session.key("ArrowRight");
                await app.session.key("Delete");
                await app.session.waitForText((text) => text.includes("<pabc</p>"), { timeoutMs: 20_000 });
                await app.session.key("Ctrl+Z");
                await app.session.waitForText((text) => text.includes("<p"), { timeoutMs: 20_000 });
                await app.session.key("End");
                // A round trip through the extension host: a wrong answer to the undo was sent before its
                // reply. At the end of a closed tag the command itself inserts nothing.
                await app.session.executeCommand("auto-close-tag.closeTag");
                await app.session.waitForText((text) => text.includes("<p>abc</p>"), { timeoutMs: 20_000 });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx": the stock markdownlint answers with diagnostics and code actions. Without
        // a config file `markdownlint.openConfigFile` writes the default config into an untitled document
        // addressed by uri; a client that ignores the uri puts it into the active editor instead.
        id: "DavidAnson.vscode-markdownlint",
        expectFiles: ["package.json", "bundle.js"],
        run: async (ctx) => {
            // The command walks `workspaceFolders`, and the session root holds user-data-dir.
            const projectRoot = join(ctx.root, "project");
            mkdirSync(projectRoot);
            const file = join(projectRoot, "page.md");
            writeFileSync(file, "# Title\n\n#bad heading\n");
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [projectRoot, file] });
            try {
                await app.session.executeCommand("workbench.actions.view.problems");
                await app.session.waitForText((text) => text.includes("MD018"), { timeoutMs: 40_000 });
                await app.session.executeCommand("workbench.action.focusActiveEditorGroup");
                await app.session.key("Ctrl+Home");
                await app.session.key("ArrowDown");
                await app.session.key("ArrowDown");
                await app.session.key("Ctrl+.");
                await app.session.waitForText((text) => text.includes("Fix this violation of MD018"), {
                    timeoutMs: 20_000,
                });
                await app.session.key("Enter");
                await app.session.waitForText((text) => text.includes("# bad heading") && !text.includes("MD018"), {
                    timeoutMs: 20_000,
                });
                await app.session.executeCommand("markdownlint.openConfigFile");
                await app.session.waitForText((text) => text.includes(".markdownlint.json") && text.includes("MD013"), {
                    timeoutMs: 20_000,
                });
                await app.session.executeCommand("workbench.action.previousEditor");
                await app.session.waitForText((text) => text.includes("# Title") && !text.includes("MD013"), {
                    timeoutMs: 20_000,
                });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx": the stock npm Intellisense reads the manifest next to the file. The builtin
        // TS client offers package.json dependencies too, so `left-pad` alone stays green without the
        // extension: TS strips the `@types/` prefix, and only this extension offers the full name.
        id: "christian-kohler.npm-intellisense",
        expectFiles: ["package.json", "out/src/extension.js"],
        run: async (ctx) => {
            // The extension registers nothing without `workspace.rootPath`, and the root holds user-data-dir.
            const projectRoot = join(ctx.root, "project");
            mkdirSync(projectRoot);
            writeFileSync(
                join(projectRoot, "package.json"),
                JSON.stringify({
                    name: "sample",
                    dependencies: { "left-pad": "1.3.0", "@types/only-npm-intellisense": "1.0.0" },
                    devDependencies: { "dev-only-mod": "1.0.0" },
                }),
            );
            const file = join(projectRoot, "a.js");
            writeFileSync(file, "");
            const app = await startHeadlessApp({
                root: ctx.root,
                keepRoot: true,
                open: [projectRoot, file],
                settings: { "npm-intellisense.scanDevDependencies": true },
            });
            try {
                // `executeCommand` rejects an id that is not registered yet, and the typing below needs the provider.
                await app.session.waitForReady();
                await app.session.executeCommand("npm-intellisense.import");
                await app.session.waitForText((text) => text.includes("npm module") && text.includes("dev-only-mod"), {
                    timeoutMs: 40_000,
                });
                await app.session.key("Escape");
                await app.session.waitForText((text) => !text.includes("npm module") && !text.includes("import {}"), {
                    timeoutMs: 20_000,
                });
                // A paste opens no completion popup, the typed quote does.
                await app.session.sendText("const x = require(");
                await app.session.key('"');
                await app.session.waitForText(
                    (text) => text.includes("left-pad") && text.includes("@types/only-npm-intellisense"),
                    { timeoutMs: 60_000 },
                );
                // By arrow, not by typing `@types`: `@` closes the popup, and it may not reopen while tsserver warms up.
                await app.session.key("ArrowDown");
                await app.session.key("Enter");
                // The pasted `(` has no auto-closed pair; the quote does.
                await app.session.waitForText((text) => text.includes('require("@types/only-npm-intellisense"'), {
                    timeoutMs: 20_000,
                });
                await app.session.key("Ctrl+Home");
                await app.session.executeCommand("npm-intellisense.import");
                await app.session.waitForText((text) => text.includes("npm module") && text.includes("dev-only-mod"), {
                    timeoutMs: 20_000,
                });
                await app.session.key("Enter");
                await app.session.waitForText((text) => text.includes("import {} from 'left-pad';"), {
                    timeoutMs: 20_000,
                });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx": the stock Trailing Spaces edits through `registerTextEditorCommand` and a
        // will-save `waitUntil`. Blanks don't show in a frame, so the status bar column at the line end
        // stands for them: 9 with the spaces, 6 without.
        id: "shardulm94.trailing-spaces",
        expectFiles: ["package.json", "dist/extension.js"],
        run: async (ctx) => {
            const source = "alpha   \nbeta  \n";
            const trimmed = "alpha\nbeta\n";
            const waitForContent = (file: string, content: string) =>
                waitUntil(
                    () => readFileSync(file, "utf8"),
                    (text) => text === content,
                    { describe: `${file} holding ${JSON.stringify(content)}`, timeoutMs: 20_000, intervalMs: 100 },
                );

            const byCommand = join(ctx.root, "command.txt");
            writeFileSync(byCommand, source);
            const commandApp = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [byCommand] });
            try {
                // Awaits activation; the highlight itself is not painted, but must not fail.
                await commandApp.session.executeCommand("trailing-spaces.highlightTrailingSpaces");
                await commandApp.session.key("Ctrl+Home");
                await commandApp.session.key("End");
                await commandApp.session.waitForText((text) => text.includes("Ln 1, Col 9"), { timeoutMs: 20_000 });
                await commandApp.session.executeCommand("trailing-spaces.deleteTrailingSpaces");
                await commandApp.session.waitForText((text) => text.includes("Ln 1, Col 6"), { timeoutMs: 20_000 });
                await commandApp.session.key("Ctrl+S");
                await waitForContent(byCommand, trimmed);
            } finally {
                await commandApp.dispose();
            }

            const onSave = join(ctx.root, "save.txt");
            writeFileSync(onSave, source);
            const saveApp = await startHeadlessApp({
                root: ctx.root,
                keepRoot: true,
                open: [onSave],
                settings: { "trailing-spaces.trimOnSave": true },
            });
            try {
                await saveApp.session.executeCommand("trailing-spaces.highlightTrailingSpaces");
                await saveApp.session.key("Ctrl+Home");
                await saveApp.session.key("End");
                await saveApp.session.waitForText((text) => text.includes("Ln 1, Col 9"), { timeoutMs: 20_000 });
                await saveApp.session.key("Ctrl+S");
                await waitForContent(onSave, trimmed);
                await saveApp.session.waitForText((text) => text.includes("Ln 1, Col 6"), { timeoutMs: 20_000 });
                // Undo brings the spaces and the caret back, and the next save trims them again.
                await saveApp.session.key("Ctrl+Z");
                await saveApp.session.waitForText((text) => text.includes("Ln 1, Col 9"), { timeoutMs: 20_000 });
                await saveApp.session.key("Ctrl+S");
                await saveApp.session.waitForText((text) => text.includes("Ln 1, Col 6"), { timeoutMs: 20_000 });
                await waitForContent(onSave, trimmed);
            } finally {
                await saveApp.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx", universal: Enter goes through `pythonIndent.newlineAndIndent`. The text is typed key
        // by key, as bracket auto-close is what sends `foo(` down the `insertSnippet` path of the extension.
        id: "KevinRose.vsc-python-indent",
        expectFiles: ["package.json", "out/extension.js", "out/parse-wasm/pythonindent_bg.wasm"],
        run: async (ctx) => {
            const file = join(ctx.root, "indent.py");
            writeFileSync(file, "\n");
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            const waitForFile = (expected: string): Promise<void> =>
                waitUntil(
                    () => readFileSync(file, "utf8"),
                    (text) => text === expected,
                    { describe: `indent.py holding ${JSON.stringify(expected)}`, timeoutMs: 20_000, intervalMs: 100 },
                ).then(() => undefined);
            try {
                await app.session.waitForReady();
                await app.session.sendText("def f(x):");
                await app.session.key("Enter");
                await app.session.sendText("y");
                // The second row of the frame, with the indent guide in the first column of the indent.
                await app.session.waitForText((text) => /\b2\s+\S\s{3}y\s*$/m.test(text) && text.includes("Ln 2, Col 6"), {
                    timeoutMs: 20_000,
                });
                await app.session.key("Ctrl+S");
                await waitForFile("def f(x):\n    y\n");

                // `sendText` is a paste and a paste does not auto-close the bracket, which is what makes this a hanging indent.
                for (const key of ["Enter", "f", "o", "o", "(", "Enter", "z"]) await app.session.key(key);
                await app.session.key("Ctrl+S");
                await waitForFile("def f(x):\n    y\n    foo(\n        z\n    )\n");
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx", platform-specific vsix (~130 MB): the stock Claude Code. Its job here is
        // the ide server: the "✻ Claude Code" item and the lock file are written at the end of activate(),
        // MCP `initialize` answers with `ideName` from `env.appName`. Context, diagnostics and terminal are
        // covered by the e2e claudeCode.test.ts.
        id: CLAUDE_CODE_ID,
        expectFiles: ["package.json", "extension.js"],
        run: async (ctx) => {
            const file = join(ctx.root, "notes.md");
            writeFileSync(file, "# notes\n");
            const app = await startHeadlessApp({
                root: ctx.root,
                keepRoot: true,
                open: [file],
                env: claudeCodeSessionEnv(),
            });
            try {
                await app.session.waitForText((text) => text.includes("✻ Claude Code"), { timeoutMs: 60_000 });
                const lock = await waitForIdeLock(app.env.home);
                const { probe, serverInfo } = await IdeProbe.connect(lock);
                probe.close();
                if (lock.ideName !== "Diode" || serverInfo.name !== "Claude Code Diode MCP") {
                    throw new Error(`IDE server is not Diode's: lock ${lock.ideName}, server ${serverInfo.name}`);
                }
            } finally {
                await app.dispose();
            }
        },
    },
];
