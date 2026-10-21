import type { ICancellationToken } from "../../../../base/common/cancellation.ts";

/**
 * Склеивает вызовы нескольких провайдеров с ОДНИМ объектом запроса в один RPC: запрос пока
 * несёт полный текст документа (дельты — задача G3), и N провайдеров дали бы N копий за нажатие.
 * «Тот же запрос» — идентичность объекта: два нажатия — два объекта.
 */
export class ProviderRequestBatcher<TRequest extends object, TResult> {
    private pending: IBatch<TRequest, TResult> | null = null;

    /**
     * @param send результаты выровнены по `handles`; `token` — отмена первого вызова пачки
     *   (потребитель раздаёт один токен всем провайдерам)
     * @param empty ответ провайдера, для которого результата не пришло
     */
    public constructor(
        private readonly send: (
            handles: readonly number[],
            request: TRequest,
            token: ICancellationToken | undefined,
        ) => Promise<readonly TResult[]>,
        private readonly empty: TResult,
    ) {}

    public call(handle: number, request: TRequest, token?: ICancellationToken): Promise<TResult> {
        const batch = this.pending?.request === request ? this.pending : this.open(request, token);
        const index = batch.handles.push(handle) - 1;
        return batch.results.then((results) => results.at(index) ?? this.empty);
    }

    private open(request: TRequest, token: ICancellationToken | undefined): IBatch<TRequest, TResult> {
        const handles: number[] = [];
        // Отправка — микротаской: синхронный проход потребителя уже добавил в пачку все
        // handle. Открыта только последняя пачка — более ранняя её не закрывает.
        const batch: IBatch<TRequest, TResult> = {
            request,
            handles,
            results: Promise.resolve().then(() => {
                if (this.pending === batch) this.pending = null;
                return this.send(handles, request, token);
            }),
        };
        this.pending = batch;
        return batch;
    }
}

interface IBatch<TRequest, TResult> {
    readonly request: TRequest;
    readonly handles: number[];
    readonly results: Promise<readonly TResult[]>;
}
