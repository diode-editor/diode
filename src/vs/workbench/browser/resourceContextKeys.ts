import { type Uri, UriUtils } from "../../base/common/uri.ts";
import type { IContextKeyContributor } from "../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

export const ResourceContextKeysDIToken = token<ResourceContextKeys>("ResourceContextKeys");

/** The upstream family, in the order upstream binds it. */
export const RESOURCE_CONTEXT_KEYS = [
    "resource",
    "resourceScheme",
    "resourceFilename",
    "resourceDirname",
    "resourcePath",
    "resourceLangId",
    "resourceExtname",
    "resourceSet",
] as const;

/**
 * Upstream's `ResourceContextKey` lives in the editor group's scoped context: it is seen while the focus is
 * inside the group and unset outside it. We have one context, so the keys follow the focus the same way:
 * `editorAreaFocus` (set by the hub before the contributors) decides. Upstream's `isFileSystemResource` is not set.
 */
export class ResourceContextKeys implements IContextKeyContributor {
    public static dependencies = [EditorServiceDIToken] as const;

    public constructor(private readonly editors: Pick<IEditorService, "getActiveEditor">) {}

    public updateContextKeys(contextKeys: ContextKeyService): void {
        const editor = contextKeys.get("editorAreaFocus") === true ? this.editors.getActiveEditor() : null;
        if (editor === null) {
            for (const key of RESOURCE_CONTEXT_KEYS) contextKeys.reset(key);
            return;
        }
        const keys = resourceContextKeysOf(editor.uri);
        contextKeys.set("resource", keys.resource);
        contextKeys.set("resourceScheme", keys.resourceScheme);
        contextKeys.set("resourceFilename", keys.resourceFilename);
        contextKeys.set("resourceDirname", keys.resourceDirname);
        contextKeys.set("resourcePath", keys.resourcePath);
        contextKeys.set("resourceLangId", editor.languageId);
        contextKeys.set("resourceExtname", keys.resourceExtname);
        contextKeys.set("resourceSet", true);
    }
}

/** The family's values for a resource, its language aside: an editor's, or a place outside editors (a test message). */
export function resourceContextKeysOf(uri: Uri) {
    return {
        resource: uri.toString(),
        resourceScheme: uri.scheme,
        resourceFilename: UriUtils.basename(uri),
        resourceDirname: toPath(UriUtils.dirname(uri)),
        resourcePath: toPath(uri),
        resourceExtname: UriUtils.extname(uri),
        resourceSet: true,
    };
}

function toPath(uri: Uri): string {
    return uri.scheme === "file" ? uri.fsPath : uri.path;
}
