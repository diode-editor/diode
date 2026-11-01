/** A full key such as `typescript.inlayHints.variableTypes.enabled`, with upstream's default as the fallback. */
export type ReadSetting = <T>(key: string, fallback: T) => T;

/** What the client watches; any change there resends all of {@link serverSettings}. */
export const SYNCHRONIZED_SECTIONS = ["typescript", "javascript"];

/**
 * The payload of `workspace/didChangeConfiguration`: typescript-language-server takes these preferences from the
 * notification alone (`workspace/configuration` is only asked for `formattingOptions`) and replaces its copy with
 * each one, so the payload is always complete.
 *
 * Upstream's keys become tsserver's preferences as in `getInlayHintsPreferences` of `typescript-language-features`;
 * note that `suppressWhen*` turns into `includeWhen*`, negated.
 */
export function serverSettings(read: ReadSetting): Record<string, unknown> {
    return {
        typescript: {
            ...languageSettings("typescript", read),
            implementationsCodeLens: {
                enabled: read("typescript.implementationsCodeLens.enabled", false),
                showOnInterfaceMethods: read("typescript.implementationsCodeLens.showOnInterfaceMethods", false),
            },
        },
        javascript: languageSettings("javascript", read),
    };
}

function languageSettings(language: "typescript" | "javascript", read: ReadSetting): Record<string, unknown> {
    const inlayHints = `${language}.inlayHints`;
    return {
        inlayHints: {
            includeInlayParameterNameHints: read(`${inlayHints}.parameterNames.enabled`, "none"),
            includeInlayParameterNameHintsWhenArgumentMatchesName: !read(
                `${inlayHints}.parameterNames.suppressWhenArgumentMatchesName`,
                true,
            ),
            includeInlayFunctionParameterTypeHints: read(`${inlayHints}.parameterTypes.enabled`, false),
            includeInlayVariableTypeHints: read(`${inlayHints}.variableTypes.enabled`, false),
            includeInlayVariableTypeHintsWhenTypeMatchesName: !read(
                `${inlayHints}.variableTypes.suppressWhenTypeMatchesName`,
                true,
            ),
            includeInlayPropertyDeclarationTypeHints: read(`${inlayHints}.propertyDeclarationTypes.enabled`, false),
            includeInlayFunctionLikeReturnTypeHints: read(`${inlayHints}.functionLikeReturnTypes.enabled`, false),
            includeInlayEnumMemberValueHints: read(`${inlayHints}.enumMemberValues.enabled`, false),
        },
        referencesCodeLens: {
            enabled: read(`${language}.referencesCodeLens.enabled`, false),
            showOnAllFunctions: read(`${language}.referencesCodeLens.showOnAllFunctions`, false),
        },
    };
}
