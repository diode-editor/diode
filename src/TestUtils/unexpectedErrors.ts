import { describeRejection } from "../vs/base/common/describeRejection.ts";
import { setUnexpectedErrorHandler } from "../vs/base/common/errors.ts";

/**
 * `Emitter` ловит исключение слушателя, и без этого «слушатель кинул» — тишина, а
 * мутант, ломающий слушателя, выживает (docs/arch/Common.md#события-eventts).
 */
export class UnexpectedErrorCollector {
    private errors: unknown[] = [];

    public install(): void {
        this.errors = [];
        setUnexpectedErrorHandler((e) => this.errors.push(e));
    }

    /** Упавший тест не трогает — его ошибка важнее. */
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
