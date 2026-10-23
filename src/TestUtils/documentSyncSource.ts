import type { IDocumentSyncSource } from "../vs/workbench/api/common/iDocumentSyncTarget.ts";
import type { IWireDocumentSyncSnapshot } from "../vs/workbench/api/common/wireTypes.ts";

/** A sync source over a ready-made snapshot — what `documentSyncSourceOfModel` builds over a model. */
export function syncSourceOf(snapshot: IWireDocumentSyncSnapshot): IDocumentSyncSource {
    return {
        uri: snapshot.uri,
        languageId: snapshot.languageId,
        version: snapshot.version,
        isDirty: snapshot.isDirty ?? false,
        length: snapshot.text.length,
        getText: () => snapshot.text,
    };
}
