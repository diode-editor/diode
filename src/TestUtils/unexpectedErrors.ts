import { describeRejection } from "../vs/base/common/describeRejection.ts";
import { setUnexpectedErrorHandler } from "../vs/base/common/errors.ts";

/**
 * `Emitter` catches listener exceptions, so without this a throwing listener goes unnoticed, and a
 * mutant that breaks the listener survives (docs/arch/Common.md#события-eventts).
 */
export class UnexpectedErrorCollector {
    private errors: unknown[] = [];

    public install(): void {
        this.errors = [];
        setUnexpectedErrorHandler((e) => this.errors.push(e));
    }

    /** Leaves a failed test alone — its own error matters more. */
    public check(testFailed: boolean): void {
        const errors = this.errors;
        this.errors = [];
        if (errors.length === 0 || testFailed) return;
        throw new Error(
            `onUnexpectedError during the test (${String(errors.length)}): ${describeRejection(errors[0])}`,
            { cause: errors[0] },
        );
    }
}
