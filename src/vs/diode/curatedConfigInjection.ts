/**
 * Layer above the manifest defaults (overrides them) and below user settings.
 *
 * - basedpyright: `fromEnvironment` looks the server up via the ms-python.python API and fails the whole
 *   activation when it is missing (the call in activate() is unguarded, checked on 1.40.0) — keep the bundled server.
 * - ruff: `fromEnvironment` depends on PATH; the bundled native binary is deterministic (bundled ≥ 0.5.3).
 * - redhat.java: lombok on jdt.ls 1.57 + JDK 21 breaks compilation of the whole project ("Internal compiler
 *   error", `NoSuchFieldError … constructorCall`). `updateBuildConfiguration` is left alone: since #352 we answer
 *   the "Synchronize now" prompt, and `"automatic"` would silently take the decision away from the user.
 * - Anthropic.claude-code: the TUI has no webview panels (docs/public/API-COVERAGE.md) — only terminal mode works.
 *
 * Ids are matched case-insensitively: VS Code extension ids are case-insensitive (`Anthropic`, `DetachHead`).
 */
export function curatedConfigInjection(extensionId: string): Record<string, unknown> {
    const id = extensionId.toLowerCase();
    if (id === "detachhead.basedpyright") {
        return { "basedpyright.importStrategy": "useBundled" };
    }
    if (id === "charliermarsh.ruff") {
        return { "ruff.importStrategy": "useBundled" };
    }
    if (id === "redhat.java") {
        return { "java.jdt.ls.lombokSupport.enabled": false };
    }
    if (id === "anthropic.claude-code") {
        return { "claudeCode.useTerminal": true };
    }
    return {};
}
