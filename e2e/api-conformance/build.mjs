/**
 * Builds the test extension from the upstream sources: upstream's manifest with `main` and
 * `activationEvents` replaced, each test file bundled, mocha placed next to them.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { build } from "esbuild";

export const SUITES = [
    "commands",
    "configuration",
    "editor",
    "env",
    "extensions",
    "languages",
    "quickInput",
    "readonlyFileSystem",
    "state",
    "terminal",
    "tree",
    "types",
    "window",
    "workspace",
    "workspace.event",
    "workspace.fs",
    "workspace.tasks",
    "workspace.watcher",
];

/** Keys the tests write in `before all` and Diode does not have: unregistered, the write would throw. */
const MISSING_SETTINGS = {
    "terminal.integrated.showExitAlert": { type: "boolean", default: true },
    "terminal.integrated.gpuAcceleration": { type: "string", default: "auto" },
    "terminal.integrated.shellIntegration.enabled": { type: "boolean", default: true },
    "terminal.integrated.environmentChangesRelaunch": { type: "boolean", default: true },
    "terminal.integrated.localEchoEnabled": { default: "off" },
    "tasks.version": { default: "2.0.0" },
    "tasks.tasks": { default: [] },
};

export function transformManifest(manifest) {
    const { scripts: _scripts, devDependencies: _devDependencies, dependencies: _dependencies, ...rest } = manifest;
    const configuration = rest.contributes?.configuration;
    if (configuration === undefined || Array.isArray(configuration)) {
        throw new Error("Upstream manifest changed: contributes.configuration is expected to be one object.");
    }
    return {
        ...rest,
        main: "./extension.js",
        activationEvents: ["*"],
        contributes: {
            ...rest.contributes,
            configuration: { ...configuration, properties: { ...configuration.properties, ...MISSING_SETTINGS } },
        },
    };
}

/**
 * Replaces a whole exported function of upstream's text. Failing here is the point: a silently
 * unpatched helper would turn into dozens of red tests with an unrelated message.
 */
function replaceFunction(source, name, replacement) {
    const pattern = new RegExp(`export async function ${name}\\(.*?\\n}\\n`, "s");
    if (!pattern.test(source)) {
        throw new Error(`Cannot patch upstream utils.ts: function ${name} not found. The tag changed its text, update e2e/api-conformance/build.mjs.`);
    }
    return source.replace(pattern, () => replacement);
}

/** Tests run on plain files in the workspace, not on `fake-fs`: virtual files are outside the epic. */
export function patchUtils(source) {
    const withCreate = replaceFunction(
        source,
        "createRandomFile",
        `export async function createRandomFile(contents: string | Uint8Array = '', dir: vscode.Uri | undefined = undefined, ext = ''): Promise<vscode.Uri> {
	const file = vscode.Uri.joinPath(dir ?? vscode.workspace.workspaceFolders![0].uri, rndName() + ext);
	await vscode.workspace.fs.writeFile(file, Buffer.from(contents));
	return file;
}
`,
    );
    return replaceFunction(
        withCreate,
        "deleteFile",
        `export async function deleteFile(file: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.delete(file);
		return true;
	} catch {
		return false;
	}
}
`,
    );
}

/** The transitive closure of a package, as paths relative to the repository root. */
export function dependencyClosure(repoRoot, packageName) {
    const seen = new Set();
    const locate = (name, from) => {
        for (let dir = from; ; dir = path.dirname(dir)) {
            const candidate = path.join(dir, "node_modules", name);
            if (existsSync(path.join(candidate, "package.json"))) return candidate;
            if (dir === repoRoot) throw new Error(`Cannot find dependency ${name} from ${from}`);
        }
    };
    const visit = (dir) => {
        const relative = path.relative(repoRoot, dir);
        if (seen.has(relative)) return;
        seen.add(relative);
        const { dependencies = {} } = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
        for (const name of Object.keys(dependencies)) visit(locate(name, dir));
    };
    visit(locate(packageName, repoRoot));
    return [...seen].sort();
}

/**
 * @param {{repoRoot: string, upstreamDir: string, extensionDir: string, workDir: string, testTimeoutMs: number}} options
 */
export async function buildExtension({ repoRoot, upstreamDir, extensionDir, workDir, testTimeoutMs }) {
    mkdirSync(extensionDir, { recursive: true });
    const manifest = JSON.parse(readFileSync(path.join(upstreamDir, "package.json"), "utf8"));
    writeFileSync(path.join(extensionDir, "package.json"), JSON.stringify(transformManifest(manifest), null, 1));

    const utilsPath = path.join(upstreamDir, "src", "utils.ts");
    writeFileSync(utilsPath, patchUtils(readFileSync(utilsPath, "utf8")));

    const common = {
        bundle: true,
        platform: "node",
        format: "cjs",
        external: ["vscode", "mocha"],
        logLevel: "error",
        // Upstream's tsconfig extends a file outside the extracted directory.
        tsconfigRaw: "{}",
    };
    await build({
        ...common,
        entryPoints: Object.fromEntries(SUITES.map((suite) => [`tests/${suite}`, path.join(upstreamDir, "src", "singlefolder-tests", `${suite}.test.ts`)])),
        outdir: extensionDir,
        // Upstream runs from `out/singlefolder-tests` next to `testWorkspace`, and tests compare
        // paths against that. The real location of an installed extension is elsewhere.
        define: { __dirname: JSON.stringify(path.join(workDir, "out", "singlefolder-tests")) },
    });
    await build({ ...common, entryPoints: [path.join(upstreamDir, "src", "extension.ts")], outfile: path.join(extensionDir, "upstreamExtension.js") });
    await build({
        ...common,
        external: [...common.external, "./upstreamExtension.js"],
        entryPoints: [path.join(import.meta.dirname, "harness", "extension.js")],
        outfile: path.join(extensionDir, "extension.js"),
        define: {
            __API_CONFORMANCE_WORK_DIR__: JSON.stringify(workDir),
            __API_CONFORMANCE_TEST_TIMEOUT_MS__: String(testTimeoutMs),
        },
    });

    for (const relative of dependencyClosure(repoRoot, "mocha")) {
        cpSync(path.join(repoRoot, relative), path.join(extensionDir, relative), { recursive: true });
    }
}
