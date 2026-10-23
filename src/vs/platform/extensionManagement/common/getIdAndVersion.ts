/**
 * Upstream `EXTENSION_IDENTIFIER_WITH_VERSION_REGEX` (`extensionManagementUtil.ts`) without `@prerelease`:
 * the registry has no pre-releases.
 */
const ID_WITH_VERSION = /^([^.]+\..+)@(\d+\.\d+\.\d+(-.*)?)$/u;

/**
 * `--install-extension publisher.name@1.2.3`, like upstream `getIdAndVersion`; anything else is all id.
 * Deviation: the id keeps its case (upstream lowercases it), the registry lookup decides about it.
 */
export function getIdAndVersion(target: string): [string, string | undefined] {
    const matches = ID_WITH_VERSION.exec(target);
    return matches === null ? [target, undefined] : [matches[1], matches[2]];
}
