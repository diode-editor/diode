// Upstream `src/vs/workbench/contrib/terminal/common/terminalEnvironment.ts`: only `getShellIntegrationTimeout`.

/**
 * Upstream `getShellIntegrationTimeout`: how long `runCommand` waits for shell integration after the process started
 * before declaring the terminal has none. Not ported: the remote window's 3000 ms (no remote windows) and the `-2`
 * override for upstream's own tests (the setting's minimum is `-1`).
 *
 * @param value `terminal.integrated.shellIntegration.timeout`
 * @param elapsed since the process started, ms
 */
export function getShellIntegrationTimeout(value: unknown, siInjectionEnabled: boolean, elapsed: number): number {
    let timeoutMs: number;
    if (typeof value !== "number" || value < 0) {
        timeoutMs = siInjectionEnabled ? 5000 : 2000;
    } else if (value === 0) {
        timeoutMs = 0;
    } else {
        timeoutMs = Math.max(value, 500);
    }
    return Math.max(0, timeoutMs - elapsed);
}
