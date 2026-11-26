// Upstream `TerminalContributionService` over the `terminal` extension point: only `profiles`, the manifest is
// foreign data, so the schema's `required: ['id', 'title']` is checked here.

/** Upstream `IExtensionTerminalProfile`. */
export interface IExtensionTerminalProfile {
    readonly extensionIdentifier: string;
    readonly id: string;
    readonly title: string;
    /** A codicon (`$(debug)` or `debug`); a URI icon is not drawn, so it is not kept. */
    readonly icon?: string;
}

/** The value of `contributes.terminal`; anything but an object or an array of `profiles` gives nothing. */
export function parseTerminalProfiles(
    extensionId: string,
    terminal: unknown,
    report: (message: string) => void,
): IExtensionTerminalProfile[] {
    const profiles = (terminal as { readonly profiles?: unknown } | null | undefined)?.profiles;
    if (!Array.isArray(profiles)) return [];
    const result: IExtensionTerminalProfile[] = [];
    for (const value of profiles as readonly unknown[]) {
        const entry = (value ?? {}) as Partial<Record<"id" | "title" | "icon", unknown>>;
        if (typeof entry.id !== "string" || entry.id === "" || typeof entry.title !== "string") {
            report("A terminal profile needs a string 'id' and 'title'; it is skipped.");
            continue;
        }
        result.push({
            extensionIdentifier: extensionId,
            id: entry.id,
            title: entry.title,
            ...(typeof entry.icon === "string" ? { icon: entry.icon } : {}),
        });
    }
    return result;
}
