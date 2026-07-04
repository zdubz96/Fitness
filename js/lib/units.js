// Weight/height unit handling. To avoid ever corrupting historical data, every logged weight
// carries the unit it was entered in (`weight_unit`); we convert to the user's current display
// preference at render time. Legacy entries without a unit are assumed to be in the current
// preference (there was essentially no data before units existed).
import { getLocal } from "../state.js";

const LB_PER_KG = 2.2046226218;

export function getUnitPref() {
  const profile = getLocal("trainer_profile") || {};
  return profile.units === "kg" ? "kg" : "lb";
}

export function kgToLb(kg) {
  return kg * LB_PER_KG;
}
export function lbToKg(lb) {
  return lb / LB_PER_KG;
}

/** Convert a weight from one unit to another. */
export function convertWeight(value, fromUnit, toUnit) {
  if (value == null || Number.isNaN(value)) return value;
  if (fromUnit === toUnit) return value;
  return fromUnit === "kg" ? kgToLb(value) : lbToKg(value);
}

/** Convert a stored weight (with its own unit) into the current display unit for showing. */
export function displayWeight(value, storedUnit) {
  const pref = getUnitPref();
  const from = storedUnit || pref;
  const converted = convertWeight(value, from, pref);
  return converted == null ? null : Math.round(converted * 10) / 10;
}

export function unitLabel() {
  return getUnitPref();
}

// Height: stored canonically in cm; displayed as cm or ft/in depending on the weight-unit pref
// (kg -> metric/cm, lb -> imperial/ft-in), which matches how people conventionally pair them.
export function heightIsMetric() {
  return getUnitPref() === "kg";
}

export function cmToFtIn(cm) {
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn - ft * 12);
  return { ft, inches };
}

export function ftInToCm(ft, inches) {
  return (Number(ft) * 12 + Number(inches)) * 2.54;
}

export function displayHeight(cm) {
  if (cm == null) return "—";
  if (heightIsMetric()) return `${Math.round(cm)} cm`;
  const { ft, inches } = cmToFtIn(cm);
  return `${ft}'${inches}"`;
}
