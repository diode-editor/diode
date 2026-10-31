export function greet(name: string): string {
    return "hi " + name;
}

export function f(a: string): void;
export function f(a: number): void;
export function f(a: unknown) {}
