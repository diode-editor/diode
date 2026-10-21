import type { ICancellationToken } from "../../../base/common/cancellation.ts";
/** Values of `vscode.SignatureHelpTriggerKind`. */
export const SignatureHelpTriggerKind = {
    Invoke: 1,
    TriggerCharacter: 2,
    /** An edit or cursor move while the hint is already open. */
    ContentChange: 3,
} as const;

export type SignatureHelpTriggerKind = (typeof SignatureHelpTriggerKind)[keyof typeof SignatureHelpTriggerKind];

export interface ISignatureHelpRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
    readonly triggerKind: SignatureHelpTriggerKind;
    readonly triggerCharacter?: string;
    readonly isRetrigger: boolean;
    /**
     * Retrigger only: keeps the overload picked with the arrows from resetting after a
     * comma, since tsserver looks up the previous signature among the new ones by label.
     */
    readonly activeSignatureHelp?: ICoreSignatureHelp;
}

/**
 * `label` is a substring of the signature label or `[start, end)` offsets into it
 * (the client declares `labelOffsetSupport`). Documentation is raw markdown.
 */
export interface ICoreParameterInfo {
    readonly label: string | readonly [number, number];
    readonly documentation?: string;
}

export interface ICoreSignature {
    readonly label: string;
    readonly documentation?: string;
    readonly parameters: readonly ICoreParameterInfo[];
    /** Absent: the shared one is used. */
    readonly activeParameter?: number;
}

/** `activeParameter` may arrive as `-1`, meaning "no active parameter" (`noActiveParameterSupport`). */
export interface ICoreSignatureHelp {
    readonly signatures: readonly ICoreSignature[];
    readonly activeSignature: number;
    readonly activeParameter: number;
}

/**
 * upstream `languages.SignatureHelpProvider`. The consumer asks providers in turn until
 * the FIRST answer instead of merging like hover/references, as the vscode API requires.
 */
export interface SignatureHelpProvider {
    readonly triggerCharacters: readonly string[];
    /** Re-request the hint while it is shown (`)`). */
    readonly retriggerCharacters: readonly string[];
    provideSignatureHelp(request: ISignatureHelpRequest, token: ICancellationToken): Promise<ICoreSignatureHelp | null>;
}
