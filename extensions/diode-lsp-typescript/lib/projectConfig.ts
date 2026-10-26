import * as path from "node:path";

/** Upstream `tsconfig.ts`, minus the `TypeScriptServiceConfiguration` (no `js/ts.implicitProjectConfig.*` here). */

export type ProjectType = "typescript" | "javascript";

/** Upstream `jsTsLanguageModes`. */
export const JS_TS_LANGUAGE_IDS: readonly string[] = ["javascript", "javascriptreact", "typescript", "typescriptreact"];

export function projectTypeForLanguage(languageId: string): ProjectType | undefined {
    switch (languageId) {
        case "typescript":
        case "typescriptreact":
            return "typescript";
        case "javascript":
        case "javascriptreact":
            return "javascript";
        default:
            return undefined;
    }
}

/** tsserver names an inferred project `/dev/null/inferredProject1*`. */
export function isImplicitProjectConfigFile(configFileName: string): boolean {
    return configFileName.startsWith("/dev/null/");
}

export function configFileBaseName(projectType: ProjectType): string {
    return projectType === "typescript" ? "tsconfig.json" : "jsconfig.json";
}

/**
 * Upstream `inferredProjectCompilerOptions` at the default `js/ts.implicitProjectConfig.*` and TS >= 5.4, with
 * the setting overrides of `module` and `target` already applied, in upstream's key order.
 */
function inferredProjectCompilerOptions(projectType: ProjectType): Record<string, string | boolean> {
    return {
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2024",
        jsx: "react-jsx",
        // Upstream `inferredProjectConfigSnippet` deletes it for TypeScript.
        ...(projectType === "javascript" ? { allowImportingTsExtensions: true } : {}),
        checkJs: false,
        experimentalDecorators: false,
        strictNullChecks: true,
        strictFunctionTypes: true,
        strict: true,
        ...(projectType === "typescript" ? { sourceMap: true } : {}),
    };
}

/** Upstream `inferredProjectConfigSnippet` without the `$0` tab stop: the text goes to disk, not into a snippet. */
export function inferredProjectConfigText(projectType: ProjectType): string {
    const compilerOptions = Object.entries(inferredProjectCompilerOptions(projectType)).map(
        ([key, value]) => `"${key}": ${JSON.stringify(value)}`,
    );
    return `{
\t"compilerOptions": {
\t\t${compilerOptions.join(",\n\t\t")}
\t},
\t"exclude": [
\t\t"node_modules",
\t\t"**/node_modules/*"
\t]
}`;
}

/**
 * `typescript.tsserverRequest` hands back tsserver's raw response; `undefined` when it carries no project
 * (an error response, a cancelled request, a server that answered something else).
 */
export function configFileFromProjectInfo(response: unknown): string | undefined {
    if (typeof response !== "object" || response === null) return undefined;
    const { type, body } = response as { type?: unknown; body?: unknown };
    if (type !== "response" || typeof body !== "object" || body === null) return undefined;
    const { configFileName } = body as { configFileName?: unknown };
    return typeof configFileName === "string" ? configFileName : undefined;
}

/** Upstream `getWorkspaceRootForResource`: the highest workspace folder that contains the file. */
export function workspaceRootForFile(roots: readonly string[], filePath: string): string | undefined {
    return [...roots]
        .sort((a, b) => a.length - b.length)
        .find((root) => filePath.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`));
}
