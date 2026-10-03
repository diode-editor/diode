import type { ICancellationToken } from "../../../../base/common/cancellation.ts";

/**
 * Склеивает вызовы прокси нескольких провайдеров одной фичи с ОДНИМ запросом в
 * один RPC `{ handles, … }`.
 *
 * Зачем: потребитель (как в upstream) спрашивает каждого подошедшего провайдера
 * отдельно — `Promise.all(ordered(doc).map((p) => p.provide(req)))`, а каждый
 * запрос пока несёт полный текст документа (document sync дельтами — задача
 * G3). Для фич «на каждый символ» (completion, folding, inline) N провайдеров
 * означали бы N копий текста за нажатие. Батчер собирает вызовы, сделанные с
 * тем же объектом запроса в одном синхронном проходе, и отправляет их одним
 * сообщением; субпроцесс обходит handle в присланном порядке и отвечает
 * массивом, выровненным по нему.
 *
 * Признак «тот же запрос» — идентичность объекта: потребитель раздаёт один и
 * тот же `request` всем провайдерам, а два разных нажатия — это два объекта.
 */
export class ProviderRequestBatcher<TRequest extends object, TResult> {
    private pending: IBatch<TRequest, TResult> | null = null;

    /**
     * @param send отправка пачки: результаты выровнены по `handles`; `token` —
     *   отмена первого вызова пачки (потребитель раздаёт один токен всем
     *   провайдерам вместе с одним запросом)
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
        // Отправка — микротаской: к этому моменту синхронный проход потребителя
        // по провайдерам уже добавил в пачку все свои handle. Открытой остаётся
        // только последняя пачка — более ранняя её не закрывает.
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
