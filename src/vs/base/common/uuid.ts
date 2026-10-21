export function generateUuid(): string {
    return globalThis.crypto.randomUUID();
}
