// Initial site list, provided by the user. Two entries from the original
// 33-name list were confirmed as copy-paste duplicates and dropped:
// "GXO A&F" (a no-hyphen repeat of "GXO-A&F") and a second, exact-text
// repeat of "GXO-H&M". Everything else is preserved verbatim — no
// normalizing/merging of names that only look similar.
//
// All 31 sites point at the local sandbox Grafana for now
// (see prisma/seed.ts) — real per-site URLs get set later without any
// code change, just updating each row's grafanaBaseUrl/grafanaApiToken.
export const INITIAL_SITE_NAMES: string[] = [
  "Apotek",
  "Aritzia-Canada",
  "Coupang-INC-14",
  "Coupang-Incheon-4",
  "DHL-Netherland",
  "DHL-Figs",
  "Dillard's",
  "Excol-Jackson",
  "Excol-Perris",
  "EssilorLuxoticca-Atlanta",
  "EssilorLuxoticca-Columbus",
  "EssilorLuxoticca-Sedico",
  "EssilorLuxoticca-FHR",
  "Evergreen",
  "Farmica-Tei",
  "GXO-A&F",
  "GXO-Apple",
  "GXO-H&M",
  "GXO-Nike",
  "GXO-Verizon",
  "H&M-Robinville",
  "H&M Canada",
  "IKEA",
  "JYSK",
  "Mercado Libre",
  "Ryder Maryland",
  "Sam's ATL",
  "Sam's LAX",
  "Walmart Canada",
  "Walmart Mexico",
  "YKK",
];
