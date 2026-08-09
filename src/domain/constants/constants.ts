export const SCORE_WEIGHTS = {
  season: 15,
  sowingMonth: 15,
  ph: 25,
  nitrogen: 8,
  phosphorus: 8,
  potassium: 8,
  soilType: 12,
  region: 9,
} as const;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const SAFETY_WARNINGS = {
  CHEMICAL_FALLBACK: "Use chemical inputs only with appropriate professional guidance and according to the product label.",
  CONSERVATIVE_LOSS: "High financial risk: this crop may produce a loss under adverse conditions.",
  ESTIMATE_ONLY: "Scenario-based estimate, not guaranteed income.",
  PEST_FORECAST: "This section provides preventive risk guidance and is not a live outbreak forecast.",
  DISCLAIMER: "Thulir provides educational, scenario-based decision support. Agricultural conditions vary by location, weather, seed variety, water availability, and farm practices. Confirm major cultivation, fertilizer, pesticide, and financial decisions with a qualified agricultural professional."
};
