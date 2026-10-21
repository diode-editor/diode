/** Unit and e2e tests use `describe.skipIf(MARKETPLACE_OFFLINE)`; scenarios use `network: true`. */
export const MARKETPLACE_OFFLINE = process.env.DIODE_E2E_OFFLINE === "1";
