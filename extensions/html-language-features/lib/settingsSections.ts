// The HTML server asks the client for the `html`, `css`, `javascript` and `js/ts` settings sections and reads them
// assuming VS Code's other builtins declared them: `css` goes straight into the CSS validator, which reads `css.lint`
// from it (`css-language-features`), and the JavaScript mode reads `js/ts.implicitProjectConfig.strictNullChecks`
// without a guard (`typescript-language-features`). Diode ships neither: the client answers `null` for a section nobody
// declares, and the validation of the whole document fails on every change. The answer is completed with what VS Code
// would send: an empty section (every lint rule at its default) and upstream's defaults of the keys the server reads.

/** Upstream defaults (`typescript-language-features` manifest) of the keys the server dereferences. */
const UPSTREAM_DEFAULTS: ReadonlyMap<string | undefined, Readonly<Record<string, unknown>>> = new Map([
    ["js/ts", { implicitProjectConfig: { experimentalDecorators: false, strictNullChecks: true } }],
]);

/** `workspace/configuration` answer, `sections[i]` for the section `names[i]`, completed with the defaults. */
export function completeSettingsSections(
    names: readonly (string | undefined)[],
    sections: readonly unknown[],
): unknown[] {
    return sections.map((section, i) => {
        return withDefaults(UPSTREAM_DEFAULTS.get(names.at(i)) ?? {}, section ?? {});
    });
}

function withDefaults(defaults: unknown, value: unknown): unknown {
    if (!isRecord(defaults) || !isRecord(value)) return value;
    const merged: Record<string, unknown> = { ...defaults, ...value };
    for (const key of Object.keys(defaults)) {
        if (key in value) merged[key] = withDefaults(defaults[key], value[key]);
    }
    return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
