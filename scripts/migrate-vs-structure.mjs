#!/usr/bin/env node
/**
 * Codemod of the big-bang migration of src/ to the vscode `src/vs/*` layout.
 *
 *  --dry-run (default) prints the plan, uncovered files and collisions (`--print` prints the table);
 *  --apply             runs `git mv`, rewrites relative imports in all .ts/.tsx
 *                      (resolution is reliable because imports always carry an extension) and
 *                      paths in configs.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

/** "TUIElement" → "tuiElement", "IRange" → "iRange", "CJK" → "cjk". */
export function camelSegment(seg) {
    if (!/^[A-Z]/.test(seg)) return seg;
    const m = /^([A-Z]+)(.*)$/.exec(seg);
    const caps = m[1];
    const rest = m[2];
    if (caps.length === 1) return caps.toLowerCase() + rest;
    if (rest === "") return caps.toLowerCase();
    // Leading acronym: the last capital belongs to the next word.
    return caps.slice(0, -1).toLowerCase() + caps.slice(-1) + rest;
}

export function camelBasename(basename) {
    const parts = basename.split(".");
    const ext = parts.pop();
    return [...parts.map(camelSegment), ext].join(".");
}

// Names are already final: camelCase is not applied to them.
const FILE_MAP = new Map(
    Object.entries({
        "src/main.ts": "src/vs/vexx/main.ts",
        "src/Extensions/Api/vscode.d.ts": "src/vscode-dts/vscode.d.ts",
        // The theme barrel re-exports both the platform half and ThemeService,
        // so it moves to the workbench side (which may import platform).
        "src/Theme/index.ts": "src/vs/workbench/services/themes/common/index.ts",
        "src/Workbench/Services/TerminalEnvironment/TerminalEnvironmentModule.ts":
            "src/vs/workbench/services/terminalEnvironment/node/terminalEnvironmentModule.ts",
        // The contract between the terminal widget (browser) and the PTY session (node)
        // is environment-neutral and lives in base/common.
        "src/TUIDom/Widgets/Terminal/ITerminalSurface.ts": "src/vs/base/common/iTerminalSurface.ts",
    }),
);

/** The first regex matching the basename. */
function byBasename(rules, fallback) {
    return (basename) => {
        for (const [re, dir] of rules) {
            if (re.test(basename)) return dir;
        }
        return fallback;
    };
}

const commonRules = byBasename(
    [
        [/^DiContainer\./, "src/vs/platform/instantiation/common"],
        [/^(CliArgs|UserDataPaths)\./, "src/vs/platform/environment/node"],
        // Terminal capability probing is part of the engine (the backend reads it).
        [/^TerminalEnv\./, "src/vs/tui/backend"],
        [/^(IClipboard|IFileClipboard|InMemoryClipboard|InMemoryFileClipboard|OscClipboard)\./, "src/vs/platform/clipboard/common"],
        [/^IFileWatcher\./, "src/vs/platform/files/common"],
        [/^IsSea\./, "src/vs/base/node"],
    ],
    "src/vs/base/common",
);

const commonAssetsRules = byBasename(
    [[/^(FsAssetAccess|createDefaultAssetAccess|PackagedRuntime)\./, "src/vs/base/node/assets"]],
    "src/vs/base/common/assets",
);

const loggingRules = byBasename([], "src/vs/platform/log/common");
const loggingSinksRules = byBasename(
    [[/^FileSink\./, "src/vs/platform/log/node"]],
    "src/vs/platform/log/common",
);

const configurationRulesFixed = byBasename(
    [
        [/^ConfigurationService\./, "src/vs/platform/configuration/node"],
        [/^KeybindingsService\./, "src/vs/platform/keybinding/node"],
        [/^(IStateService|NullStateService)\./, "src/vs/platform/state/common"],
        [/^StateService\./, "src/vs/platform/state/node"],
    ],
    "src/vs/platform/configuration/common",
);

const themeRules = byBasename(
    [
        [/^(ThemeService|ThemeRegistry|ThemeTokens)\./, "src/vs/workbench/services/themes/common"],
    ],
    "src/vs/platform/theme/common",
);

const editorRules = byBasename(
    [
        [/^(IPosition|IRange|ISelection|ITextEdit|EndOfLine|WordClassification)\./, "src/vs/editor/common/core"],
        [/^(TextDocument|UndoManager|ITextDocument|IDocumentContentChange|IDocumentLanguageChange|IUndoElement|Encoding|IndentationDetector)\./, "src/vs/editor/common/model"],
        [/^EditorViewState\./, "src/vs/editor/common/viewModel"],
        [/^(AutoIndent|ILineTokens|ICompletionSource)\./, "src/vs/editor/common/languages"],
        [/^EditorElement\./, "src/vs/editor/browser"],
        [/^(findMatches|computeWordOccurrences)\./, "src/vs/editor/contrib/find"],
        [/^(FoldingRangeProvider|IFoldingRegion)\./, "src/vs/editor/contrib/folding"],
        [/^ISaveParticipant\./, "src/vs/workbench/services/textfile/common"],
    ],
    "src/vs/editor/common",
);

const editorTokenizationRules = byBasename(
    [[/^DocumentTokenStore\./, "src/vs/editor/common/tokens"]],
    "src/vs/editor/common/languages",
);

const WIDGET_DIR_OVERRIDES = {
    scrollable: "scrollbar",
    scrollbarrenderer: "scrollbar",
    scrollcontainer: "scrollbar",
    scrollviewport: "scrollbar",
    iscrollable: "scrollbar",
    treeview: "tree",
    itreedataprovider: "tree",
    input: "inputbox",
    inputstate: "inputbox",
    menubar: "menu",
    menubaritem: "menu",
    popupmenu: "menu",
    popupmenuitem: "menu",
    overlaylayer: "contextview",
    completionitemkindicon: "completionlist",
    editortabitem: "editorgroup",
    editortabstrip: "editorgroup",
    hflex: "layout",
    vstack: "layout",
    paddingcontainer: "layout",
    fitcontent: "layout",
    sizedbox: "layout",
    box: "layout",
    boxcontainer: "layout",
    textblock: "text",
    textlabel: "text",
    panelcontainer: "panel",
};

function widgetDir(basename) {
    const stem = basename.split(".")[0].replace(/Element$/, "");
    const key = stem.toLowerCase();
    const dir = WIDGET_DIR_OVERRIDES[key] ?? key;
    return `src/vs/base/browser/ui/${dir}`;
}

const workbenchServicesRules = byBasename(
    [
        [/^CommandRegistry\./, "src/vs/platform/commands/common"],
        [/^(ContextKeyService|ContextKeys)\./, "src/vs/platform/contextkey/common"],
        [/^(KeybindingRegistry|ModifierReleaseArmory)\./, "src/vs/platform/keybinding/common"],
        // The dispatcher knows the status bar (chord hint) and terminal modes, so workbench.
        [/^KeybindingDispatcher\./, "src/vs/workbench/services/keybinding/browser"],
        // The service drives a shared widget component (ThemedComponent), so the workbench side;
        // only the QuickAccess registry (data) moves to platform/quickinput.
        [/^QuickInputService\./, "src/vs/workbench/browser/parts/quickinput"],
        [/^(QuickOpenService|QuickOpenParsing)\./, "src/vs/workbench/contrib/quickaccess/browser"],
        [/^ChokidarFileWatcher\./, "src/vs/platform/files/node"],
        [/^IFileWatcherDIToken\./, "src/vs/platform/files/common"],
        [/^(CoreTokens|StateKeys)\./, "src/vs/workbench/common"],
        [/^DialogService\./, "src/vs/workbench/services/dialogs/browser"],
        [/^LifecycleService\./, "src/vs/workbench/services/lifecycle/browser"],
        [/^LayoutService\./, "src/vs/workbench/services/layout/browser"],
        [/^StatusBarService\./, "src/vs/workbench/services/statusbar/common"],
        [/^EditorService\./, "src/vs/workbench/services/editor/browser"],
        [/^EditorStatusContribution\./, "src/vs/workbench/browser/parts/editor"],
        [/^(ExplorerService|FileTreeDataProvider|FileOperationsService|InputWidgetService)\./, "src/vs/workbench/contrib/files/browser"],
        [/^FileSearchService\./, "src/vs/workbench/services/search/node"],
        [/^(CompletionService|collectWordCompletions)\./, "src/vs/workbench/contrib/suggest/browser"],
        [/^FindService\./, "src/vs/workbench/contrib/find/browser"],
        [/^PanelService\./, "src/vs/workbench/browser/parts/panel"],
        [/^(WorkbenchContextKeys|WorkbenchStateService)\./, "src/vs/workbench/browser"],
    ],
    "src/vs/workbench/services",
);

const workbenchActionsRules = byBasename(
    [
        [/^CommandAction\./, "src/vs/platform/actions/common"],
        [/^(FileTreeActions|FileTreeClipboardActions|FileTreeCreateActions|FileActions)\./, "src/vs/workbench/contrib/files/browser"],
        [/^FindActions\./, "src/vs/workbench/contrib/find/browser"],
        [/^SuggestActions\./, "src/vs/workbench/contrib/suggest/browser"],
        [/^TerminalActions\./, "src/vs/workbench/contrib/terminal/browser"],
        [/^ThemeActions\./, "src/vs/workbench/contrib/themes/browser"],
        [/^PreferencesActions\./, "src/vs/workbench/contrib/preferences/browser"],
        [/^QuickOpenActions\./, "src/vs/workbench/contrib/quickaccess/browser"],
    ],
    "src/vs/workbench/browser/actions",
);

const workbenchMenusRules = byBasename(
    [
        // The aggregate and contexts know about builtinActions/features, so the workbench side.
        [/^(menuContributions|menuContexts)\./, "src/vs/workbench/browser/actions"],
    ],
    "src/vs/platform/actions/common",
);

const workbenchContributionsRules = byBasename(
    [
        [/^(IWorkbenchContribution|WorkbenchContributionsRegistry)\./, "src/vs/workbench/common"],
        [/^workbenchContributions\./, "src/vs/workbench/browser"],
        [/^AutoRevealContribution\./, "src/vs/workbench/contrib/files/browser"],
        [/^OpenFileCommandContribution\./, "src/vs/workbench/contrib/files/browser"],
        [/^EditorContextMenuContribution\./, "src/vs/workbench/browser/parts/editor"],
        [/^ThemeConfigContribution\./, "src/vs/workbench/contrib/themes/browser"],
    ],
    "src/vs/workbench/common",
);

const workbenchTerminalRules = byBasename(
    [
        [/^(EmbeddedTerminalSession|loadNodePty)\./, "src/vs/workbench/contrib/terminal/node"],
        [/^TerminalService\./, "src/vs/workbench/contrib/terminal/browser"],
    ],
    "src/vs/workbench/contrib/terminal/common",
);

const workbenchDiagnosticsRules = byBasename(
    [[/^SettingsDiagnostics\./, "src/vs/workbench/contrib/preferences/common"]],
    "src/vs/workbench/contrib/markers/browser",
);

const workbenchWorkspaceRules = byBasename(
    [
        [/^(UndoRedoService|IUndoRedoElement)\./, "src/vs/platform/undoRedo/common"],
        [/^TrashService\./, "src/vs/platform/files/node"],
        [/^fileClipboardFs\./, "src/vs/platform/files/node"],
        [/^WorkspaceEditService\./, "src/vs/workbench/contrib/bulkEdit/node"],
        [/^WorkspaceEdit\./, "src/vs/workbench/contrib/bulkEdit/common"],
    ],
    "src/vs/platform/undoRedo/common",
);

const componentsEditorRules = byBasename(
    [
        [/^FindComponent\./, "src/vs/workbench/contrib/find/browser"],
        [/^SuggestComponent\./, "src/vs/workbench/contrib/suggest/browser"],
    ],
    "src/vs/workbench/browser/parts/editor",
);

const componentsPanelRules = byBasename(
    [
        [/^ProblemsComponent\./, "src/vs/workbench/contrib/markers/browser"],
        [/^TerminalPanelComponent\./, "src/vs/workbench/contrib/terminal/browser"],
    ],
    "src/vs/workbench/browser/parts/panel",
);

const extensionsRules = byBasename(
    [
        [/^ExtensionInstaller\./, "src/vs/platform/extensionManagement/node"],
        [/^(ExtensionTokenizationContributor|BuiltinLanguagePacks)\./, "src/vs/workbench/services/extensions/common"],
        [/^LanguageRegistry\./, "src/vs/workbench/services/language/common"],
    ],
    "src/vs/platform/extensions/common",
);

const extensionsHostRules = byBasename(
    [
        [/Adapter(s)?\./, "src/vs/workbench/api/browser"],
        [/^(ExtensionHost|ExtensionHostSubprocess|IExtensionEntry)/, "src/vs/workbench/services/extensions/node"],
        [/^(IMessageChannel|InProcessChannelPair|IpcMessageChannel|RpcEndpoint|WireTypes)\./, "src/vs/workbench/api/common"],
    ],
    "src/vs/workbench/api/common",
);

// Order doesn't matter: the longest matching prefix wins.
const DIR_RULES = {
    "src/Common": commonRules,
    "src/Common/Assets": commonAssetsRules,
    "src/Common/Logging": loggingRules,
    "src/Common/Logging/sinks": loggingSinksRules,
    "src/Configuration": configurationRulesFixed,
    "src/Theme": themeRules,
    "src/Theme/colors": () => "src/vs/platform/theme/common/colors",
    "src/Theme/themes": () => "src/vs/workbench/services/themes/common/themes",
    "src/Theme/Tokenization": () => "src/vs/workbench/services/themes/common",
    "src/Editor": editorRules,
    "src/Editor/Decorations": () => "src/vs/editor/common/model",
    "src/Editor/EditorTestUtils": () => "src/vs/editor/test/common",
    "src/Editor/Markers": () => "src/vs/platform/markers/common",
    "src/Editor/Tokenization": editorTokenizationRules,
    "src/Editor/Tokenization/builtin": () => "src/vs/editor/common/languages/builtin",
    "src/Editor/Tokenization/textmate": () => "src/vs/workbench/services/textMate/common",
    "src/Editor/Tokenization/textmate/learning": () => "src/vs/workbench/services/textMate/common/learning",
    "src/Input": () => "src/vs/tui/input",
    // packRgb/StyleFlags are pure packed-color helpers read by the whole stack
    // down to base/common (FileIcons), so they are base, not the engine.
    "src/Rendering": byBasename(
        [[/^(ColorUtils|StyleFlags)\./, "src/vs/base/common"]],
        "src/vs/tui/rendering",
    ),
    "src/Backend": () => "src/vs/tui/backend",
    "src/TUIDom": () => "src/vs/base/browser",
    "src/TUIDom/Events": () => "src/vs/base/browser/events",
    "src/TUIDom/JSX": () => "src/vs/base/browser/jsx",
    "src/TUIDom/Styles": () => "src/vs/base/browser/styles",
    "src/TUIDom/Widgets": widgetDir,
    "src/TUIDom/Widgets/Terminal": () => "src/vs/base/browser/ui/terminal",
    "src/Workbench": () => "src/vs/workbench/browser",
    "src/Workbench/Actions": workbenchActionsRules,
    "src/Workbench/Components/Dialogs": () => "src/vs/workbench/browser/parts/dialogs",
    "src/Workbench/Components/Editor": componentsEditorRules,
    "src/Workbench/Components/Explorer": () => "src/vs/workbench/contrib/files/browser",
    "src/Workbench/Components/Panel": componentsPanelRules,
    "src/Workbench/Components/QuickInput": () => "src/vs/workbench/browser/parts/quickinput",
    "src/Workbench/Components/Shell": () => "src/vs/workbench/browser",
    "src/Workbench/Components/StatusBar": () => "src/vs/workbench/browser/parts/statusbar",
    "src/Workbench/Configuration": () => "src/vs/workbench/common/configuration",
    "src/Workbench/Contributions": workbenchContributionsRules,
    "src/Workbench/Menus": workbenchMenusRules,
    "src/Workbench/Modules": () => "src/vs/vexx/modules",
    "src/Workbench/Services": workbenchServicesRules,
    "src/Workbench/Services/Diagnostics": workbenchDiagnosticsRules,
    // The registry uses a DI accessor (workbench infrastructure) and the providers
    // pull in search/parsing, so the whole cluster is the workbench side, as in vscode
    // (quick open providers live in workbench/contrib/quickaccess).
    "src/Workbench/Services/QuickAccess": byBasename(
        [[/^(IQuickAccessProvider|QuickAccessRegistry)\./, "src/vs/workbench/contrib/quickaccess/common"]],
        "src/vs/workbench/contrib/quickaccess/browser",
    ),
    "src/Workbench/Services/Terminal": workbenchTerminalRules,
    "src/Workbench/Services/TerminalEnvironment": () => "src/vs/workbench/services/terminalEnvironment/node",
    "src/Workbench/Services/TextFile": () => "src/vs/workbench/services/textfile/common",
    "src/Workbench/Services/Workspace": workbenchWorkspaceRules,
    "src/Workbench/Styles": () => "src/vs/platform/theme/browser",
    "src/Extensions": extensionsRules,
    "src/Extensions/Host": extensionsHostRules,
    "src/Extensions/Host/Vscode": () => "src/vs/workbench/api/common",
    "src/Extensions/Host/__fixtures__": () => "src/vs/workbench/services/extensions/node/__fixtures__",
};

const UNMOVED_PREFIXES = ["src/Inspector", "src/TestUtils", "src/StoryRunner", "src/demos"];

const BUILTIN_EXTENSIONS_FROM = "src/Extensions/builtin";
const BUILTIN_EXTENSIONS_TO = "extensions";

// Only for globs and directories; exact file paths come from the move table.
const TEXT_REPLACEMENTS = [
    ["src/main.ts", "src/vs/vexx/main.ts"],
    ["src/Extensions/builtin", "extensions"],
    ["src/Extensions/Host/__fixtures__", "src/vs/workbench/services/extensions/node/__fixtures__"],
    ["src/TUIDom/JSX", "src/vs/base/browser/jsx"],
    ["src/Workbench/Configuration", "src/vs/workbench/common/configuration"],
    ["src/Theme/themes", "src/vs/workbench/services/themes/common/themes"],
];

/**
 * Paths the import rewriter doesn't see (from import.meta.url, resolve(root, "src", …)).
 * The key is the NEW file path. A pattern not found is a warning, not a failure: some
 * patterns exist only before or after the phase 1 PR merge.
 */
const FILE_FIXUPS = {
    "src/vs/base/node/assets/createDefaultAssetAccess.ts": [
        [
            `    // src/Common/Assets → src
    const srcRoot = path.resolve(here, "..", "..");
    const builtinDir = path.resolve(srcRoot, "Extensions", "builtin");`,
            `    // src/vs/base/node/assets → repo root
    const repoRootDir = path.resolve(here, "..", "..", "..", "..", "..");
    const builtinDir = path.resolve(repoRootDir, "extensions");`,
        ],
        // The old comment in the file is Russian: "\u0432" is "v" (in), "\u043a" is "k" (to).
        ["\u0432 \`src/Extensions/builtin/\`", "\u0432 \`extensions/\`"],
        ["\u043a \`src/Extensions/builtin/\`", "\u043a \`extensions/\`"],
    ],
    "src/vs/workbench/services/textMate/common/learning/testRegistry.ts": [
        [
            `path.resolve(here, "..", "..", "..", "..", "Extensions", "builtin")`,
            `path.resolve(here, "..", "..", "..", "..", "..", "..", "..", "extensions")`,
        ],
    ],
    "scripts/pack-assets.mjs": [
        [`const builtinSrc = resolve(repoRoot, "src", "Extensions", "builtin");`, `const builtinSrc = resolve(repoRoot, "extensions");`],
    ],
    "scripts/build-extensions.mjs": [
        [`resolve(repoRoot, "src", "Extensions", "builtin")`, `resolve(repoRoot, "extensions")`],
    ],
    "scripts/generate-settings-schema.mjs": [
        [
            `resolve(repoRoot, "src", "Extensions", "builtin", "vexx-settings", "settings-schema.generated.ts")`,
            `resolve(repoRoot, "extensions", "vexx-settings", "settings-schema.generated.ts")`,
        ],
        [`resolve(repoRoot, "src", "Extensions", "builtin")`, `resolve(repoRoot, "extensions")`],
        // The variant before the PR #170 merge (defaults.ts) and after it (configuration nodes).
        [
            `resolve(repoRoot, "src", "Configuration", "defaults.ts")`,
            `resolve(repoRoot, "src", "vs", "platform", "configuration", "common", "defaults.ts")`,
        ],
        [
            `resolve(repoRoot, "src", "Workbench", "Configuration", "configurationContributions.ts")`,
            `resolve(repoRoot, "src", "vs", "workbench", "common", "configuration", "configurationContributions.ts")`,
        ],
        [
            `resolve(repoRoot, "src", "Theme", "themes", "builtinThemes.ts")`,
            `resolve(repoRoot, "src", "vs", "workbench", "services", "themes", "common", "themes", "builtinThemes.ts")`,
        ],
    ],
    // The search integration test asserts real repo file names.
    "src/vs/workbench/services/search/node/fileSearchService.integration.test.ts": [
        ["\"WorkbenchComponent.ts\"", "\"workbenchComponent.ts\""],
        ["\"WorkbenchComponent\"", "\"workbenchComponent\""],
        ["\"FileTreeDataProvider.ts\"", "\"fileTreeDataProvider.ts\""],
        ["\"DiContainer.ts\"", "\"diContainer.ts\""],
        ["\"CommandRegistry.ts\"", "\"commandRegistry.ts\""],
        ["\"KeybindingRegistry.ts\"", "\"keybindingRegistry.ts\""],
        ["\"FuzzySearch.ts\"", "\"fuzzySearch.ts\""],
        ["\"InputElement.ts\"", "\"inputElement.ts\""],
        ["\"NodeTerminalBackend.ts\"", "\"nodeTerminalBackend.ts\""],
        ["\"ScrollBarRenderer.ts\"", "\"scrollBarRenderer.ts\""],
        ["\"ScrollContainerElement.ts\"", "\"scrollContainerElement.ts\""],
        ["\"Workbench/\"", "\"workbench/\""],
        ["\"TUIDom/\"", "\"base/browser/\""],
        ["\"Editor/\"", "\"editor/\""],
        ["\"wbc\"", "\"wbc\""],
    ],
    "vitest.config.ts": [
        [
            `include: ["src/**/*.test.ts", "src/**/*.test.tsx"],`,
            `include: ["src/**/*.test.ts", "src/**/*.test.tsx", "extensions/**/*.test.ts"],`,
        ],
        [`include: ["src/**/*.ts"],`, `include: ["src/**/*.ts", "extensions/**/*.ts"],`],
    ],
};

const TEXT_REPLACEMENT_FILES = [
    "package.json",
    "tsconfig.json",
    "tsup.config.ts",
    "vitest.config.ts",
    "vitest.e2e.config.ts",
    "vitest.perf.config.ts",
    "scripts/build-extensions.mjs",
    "scripts/generate-settings-schema.mjs",
    "scripts/build-sea.mjs",
    "scripts/build-selfextract.mjs",
    "scripts/import-vscode-themes.mjs",
];

function listFiles(dir, out = []) {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
            listFiles(rel, out);
        } else {
            out.push(rel);
        }
    }
    return out;
}

export function mapFile(rel) {
    if (FILE_MAP.has(rel)) return FILE_MAP.get(rel);
    if (UNMOVED_PREFIXES.some((p) => rel === p || rel.startsWith(`${p}/`))) return rel;
    if (rel.startsWith(`${BUILTIN_EXTENSIONS_FROM}/`)) {
        return `${BUILTIN_EXTENSIONS_TO}/${rel.slice(BUILTIN_EXTENSIONS_FROM.length + 1)}`;
    }
    const dir = path.dirname(rel);
    const basename = path.basename(rel);
    let bestPrefix = null;
    for (const prefix of Object.keys(DIR_RULES)) {
        if ((dir === prefix || dir.startsWith(`${prefix}/`)) && (bestPrefix === null || prefix.length > bestPrefix.length)) {
            bestPrefix = prefix;
        }
    }
    if (bestPrefix === null) return null;
    const target = DIR_RULES[bestPrefix](basename, rel);
    if (target === null || target === undefined) return null;
    return `${target}/${camelBasename(basename)}`;
}

export function computeMoves() {
    const files = listFiles("src");
    const moves = new Map();
    const unmapped = [];
    for (const rel of files) {
        const to = mapFile(rel);
        if (to === null) {
            unmapped.push(rel);
        } else if (to !== rel) {
            moves.set(rel, to);
        }
    }
    const byTarget = new Map();
    const collisions = [];
    for (const [from, to] of moves) {
        if (byTarget.has(to)) collisions.push(`${byTarget.get(to)} + ${from} -> ${to}`);
        byTarget.set(to, from);
        if (existsSync(path.join(repoRoot, to))) collisions.push(`target exists: ${to} (from ${from})`);
    }
    return { moves, unmapped, collisions };
}

export function rewriteImports(fileRel, content, moves) {
    const fileNewDir = path.dirname(moves.get(fileRel) ?? fileRel);
    // Only in import contexts: bare literals with ./ paths are test data (virtual asset paths).
    return content.replace(
        /(from\s*|import\s*\(\s*|require\s*\(\s*|new URL\(\s*|vi\.(?:mock|doMock|importActual|importMock)[^(]*\(\s*|^import\s+)(["'])(\.\.?\/[^"']+?\.(?:ts|tsx|cjs|mjs|json))\2/gm,
        (whole, prefix, quote, spec) => {
        const oldTargetRel = path
            .normalize(path.join(path.dirname(fileRel), spec))
            .split(path.sep)
            .join("/");
        const newTargetRel = moves.get(oldTargetRel) ?? oldTargetRel;
        let next = path.posix.relative(fileNewDir, newTargetRel);
        if (!next.startsWith(".")) next = `./${next}`;
        return `${prefix}${quote}${next}${quote}`;
        },
    );
}

function gitMv(from, to) {
    mkdirSync(path.dirname(path.join(repoRoot, to)), { recursive: true });
    execFileSync("git", ["mv", from, to], { cwd: repoRoot });
}

function main() {
    const apply = process.argv.includes("--apply");
    const { moves, unmapped, collisions } = computeMoves();

    if (unmapped.length > 0) {
        console.error(`UNMAPPED (${unmapped.length}):`);
        for (const f of unmapped) console.error(`  ${f}`);
    }
    if (collisions.length > 0) {
        console.error(`COLLISIONS (${collisions.length}):`);
        for (const c of collisions) console.error(`  ${c}`);
    }
    if (!apply) {
        console.log(`[dry-run] ${moves.size} files to move, ${unmapped.length} unmapped, ${collisions.length} collisions`);
        if (process.argv.includes("--print")) {
            for (const [from, to] of [...moves].sort()) console.log(`${from} -> ${to}`);
        }
        process.exitCode = unmapped.length > 0 || collisions.length > 0 ? 1 : 0;
        return;
    }
    if (unmapped.length > 0 || collisions.length > 0) {
        console.error("refusing to apply with unmapped files or collisions");
        process.exit(1);
    }

    for (const [from, to] of moves) gitMv(from, to);

    const roots = ["src", "e2e", "extensions"].filter((r) => existsSync(path.join(repoRoot, r)));
    const tsFiles = [];
    for (const r of roots) listFiles(r, tsFiles);
    for (const extra of ["tsup.config.ts", "vitest.config.ts", "vitest.e2e.config.ts", "vitest.perf.config.ts"]) {
        if (existsSync(path.join(repoRoot, extra))) tsFiles.push(extra);
    }
    // The table is keyed by OLD paths, while the files already sit at the new ones.
    const newToOld = new Map([...moves].map(([from, to]) => [to, from]));
    for (const rel of tsFiles) {
        if (!/\.(ts|tsx)$/.test(rel)) continue;
        const abs = path.join(repoRoot, rel);
        const oldRel = newToOld.get(rel) ?? rel;
        const content = readFileSync(abs, "utf8");
        const next = rewriteImports(oldRel, content, moves);
        if (next !== content) writeFileSync(abs, next, "utf8");
    }

    // Exact paths from the table first (this also catches camelCase renames), then prefixes.
    for (const rel of TEXT_REPLACEMENT_FILES) {
        const abs = path.join(repoRoot, rel);
        if (!existsSync(abs)) continue;
        let content = readFileSync(abs, "utf8");
        content = content.replace(/(["'])(src\/[^"']+)\1/g, (whole, quote, p) =>
            moves.has(p) ? `${quote}${moves.get(p)}${quote}` : whole,
        );
        for (const [from, to] of TEXT_REPLACEMENTS) content = content.replaceAll(from, to);
        writeFileSync(abs, content, "utf8");
    }

    for (const [rel, fixups] of Object.entries(FILE_FIXUPS)) {
        const abs = path.join(repoRoot, rel);
        if (!existsSync(abs)) {
            console.warn(`[fixups] file not found: ${rel}`);
            continue;
        }
        let content = readFileSync(abs, "utf8");
        for (const [from, to] of fixups) {
            if (!content.includes(from)) {
                console.warn(`[fixups] pattern not found in ${rel}: ${from.slice(0, 60)}…`);
                continue;
            }
            content = content.replaceAll(from, to);
        }
        writeFileSync(abs, content, "utf8");
    }

    console.log(`[apply] moved ${moves.size} files, rewrote imports in ${tsFiles.length} candidates`);
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) main();
