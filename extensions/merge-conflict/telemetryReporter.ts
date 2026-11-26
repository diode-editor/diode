// Stands in for `@vscode/extension-telemetry` in the vendored Merge Conflict sources (`IMPORT_SUBSTITUTES` in
// scripts/import-vscode-editor.mjs). Diode sends no telemetry: the reporter takes events and drops them. Upstream
// constructs it with the manifest's `aiKey`, which the builtin manifest no longer has: it is undefined.
export default class TelemetryReporter {
    public constructor(public readonly aiKey?: string) {}

    public sendTelemetryEvent(
        _eventName: string,
        _properties?: Record<string, string>,
        _measurements?: Record<string, number>,
    ): void {
        /* no-op */
    }

    public dispose(): void {
        /* no-op */
    }
}
