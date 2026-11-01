import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

export interface IDefinitionRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
}

/** For a LocationLink, `range` is `targetSelectionRange ?? targetRange`. */
export interface ICoreDefinitionLocation {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly range: IRange;
}

/** upstream `languages.DefinitionProvider`. */
export interface DefinitionProvider {
    provideDefinition(
        request: IDefinitionRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]>;
}

/** upstream `languages.ImplementationProvider`: the same request and targets as a definition. */
export interface ImplementationProvider {
    provideImplementation(
        request: IDefinitionRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]>;
}
