/** Юнитам и e2e — `describe.skipIf(MARKETPLACE_OFFLINE)`, сценариям — `network: true`. */
export const MARKETPLACE_OFFLINE = process.env.DIODE_E2E_OFFLINE === "1";
