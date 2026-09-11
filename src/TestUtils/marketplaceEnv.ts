/**
 * Общий флаг сьютов, которые ставят стоковые расширения из публичного магазина
 * (конвенция — docs/TESTING.md «Тесты на стоковые расширения — из магазина»):
 * `DIODE_E2E_OFFLINE=1` пропускает их все — юнитам и e2e через
 * `describe.skipIf(MARKETPLACE_OFFLINE)`, сценариям — через `network: true`.
 */
export const MARKETPLACE_OFFLINE = process.env["DIODE_E2E_OFFLINE"] === "1";
