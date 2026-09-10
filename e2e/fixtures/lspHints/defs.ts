export function describe(what: string): string;
export function describe(what: string, times: number): string;
export function describe(what: string, times = 1): string {
    return what.repeat(times);
}
