import type { Uri } from "../../../../base/common/uri.ts";

/**
 * Non-disk resources whose text comes from an extension provider
 * (`registerTextDocumentContentProvider`: `jdt:` in `redhat.java`). Read-only by
 * construction, per the `TextDocumentContentProvider` contract.
 */
export interface IVirtualDocumentSource {
    canProvide(scheme: string): boolean;

    /**
     * `null`: the scheme has a provider, but it returned nothing for the resource
     * (`ProviderResult`). A rejection means the provider broke; the caller must survive it.
     */
    provide(uri: Uri): Promise<string | null>;
}

/** `EditorService` default until the composition wires in the real one. */
export const NULL_VIRTUAL_DOCUMENT_SOURCE: IVirtualDocumentSource = {
    canProvide: () => false,
    provide: () => Promise.resolve(null),
};
