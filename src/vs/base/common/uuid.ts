/**
 * Случайный UUID v4 (аналог `generateUuid` эталона, `base/common/uuid.ts`).
 * Только из функций рантайма: на верхнем уровне модуля случайность запрещена
 * (V8-снапшот, docs/arch/Common.md).
 */
export function generateUuid(): string {
    return globalThis.crypto.randomUUID();
}
