import { describeRejection } from "../vs/base/common/describeRejection.ts";
import { setUnexpectedErrorHandler } from "../vs/base/common/errors.ts";

/**
 * Копит то, что ушло в `onUnexpectedError` за время теста, и роняет тест,
 * если там что-то есть. Без этого изоляция ошибок слушателей (`Emitter` ловит
 * исключение слушателя) превращает «слушатель кинул → тест упал» в «слушатель
 * кинул → тишина», и мутант, ломающий слушателя, выживает (docs/TODO/Events.md).
 * Ставится на каждый тест из общего setupFiles (`unexpectedErrors.setup.ts`).
 */
export class UnexpectedErrorCollector {
    private errors: unknown[] = [];

    public install(): void {
        this.errors = [];
        setUnexpectedErrorHandler((e) => this.errors.push(e));
    }

    /** Бросает первую собранную ошибку; упавший тест не трогает — его ошибка важнее. */
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
