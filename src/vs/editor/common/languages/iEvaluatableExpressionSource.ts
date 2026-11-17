import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IPosition } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";

export interface IEvaluatableExpressionRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based. */
    readonly position: IPosition;
}

/** upstream `languages.EvaluatableExpression`. */
export interface IEvaluatableExpression {
    /** 0-based. */
    readonly range: IRange;
    /** Absent: the text of the range is evaluated. */
    readonly expression?: string;
}

/** upstream `languages.EvaluatableExpressionProvider`. `null` means the provider has nothing at the position. */
export interface EvaluatableExpressionProvider {
    provideEvaluatableExpression(
        request: IEvaluatableExpressionRequest,
        token: ICancellationToken,
    ): Promise<IEvaluatableExpression | null>;
}
