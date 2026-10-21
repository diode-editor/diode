import type { IExtensionRegistrySource } from "../common/iExtensionRegistrySource.ts";

import { FileExtensionRegistrySource } from "./fileRegistrySource.ts";
import { HttpExtensionRegistrySource } from "./httpRegistrySource.ts";

export const DEFAULT_REGISTRY_URL = "https://diode-editor.github.io/registry/v1/";

/** By prefix, not `new URL`: a Windows `C:\registry` parses as a URL with protocol `c:`. */
function isHttpUrl(spec: string): boolean {
    const lower = spec.toLowerCase();
    return lower.startsWith("http://") || lower.startsWith("https://");
}

export function createRegistrySource(
    spec: string | undefined,
    onProblem?: (message: string) => void,
): IExtensionRegistrySource {
    const target = spec ?? DEFAULT_REGISTRY_URL;
    return isHttpUrl(target)
        ? new HttpExtensionRegistrySource(target, onProblem)
        : new FileExtensionRegistrySource(target, onProblem);
}
