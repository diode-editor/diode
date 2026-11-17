import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

/** Upstream `languages.InlineValueContext`. */
export interface IInlineValueContext {
    /** The DAP id of the stack frame the execution stopped in. */
    readonly frameId: number;
    /** 0-based, the frame's range. */
    readonly stoppedLocation: IRange;
}

export interface IInlineValuesRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based, the lines the editor shows. */
    readonly viewPort: IRange;
    readonly context: IInlineValueContext;
}

/** Upstream `languages.InlineValue`: the text itself, a variable to look up or an expression to evaluate. 0-based. */
export type InlineValue =
    | { readonly type: "text"; readonly range: IRange; readonly text: string }
    | {
          readonly type: "variable";
          readonly range: IRange;
          /** Absent: the range's text. */
          readonly variableName?: string;
          readonly caseSensitiveLookup: boolean;
      }
    | {
          readonly type: "expression";
          readonly range: IRange;
          /** Absent: the range's text. */
          readonly expression?: string;
      };

/** Upstream `languages.InlineValuesProvider`; `null` — the provider has none. */
export interface InlineValuesProvider {
    provideInlineValues(
        request: IInlineValuesRequest,
        token: ICancellationToken,
    ): Promise<readonly InlineValue[] | null>;
}
