import { defaultCalculators } from './calculators-model.js';
import { tr } from './i18n.js';

const defaults = new Map(defaultCalculators().map(calculator => [calculator.id, calculator]));

// Translate only an unchanged built-in label. Renamed or custom definitions are data.
export function calculatorLabel(calculator, key, section, index) {
  const original = defaults.get(calculator.id);
  const row = section ? calculator[section]?.[index] : calculator;
  const baseline = section === 'fields'
    ? original?.fields?.find(field => field.ref === row?.ref)
    : section ? original?.[section]?.[index] : original;
  const value = row?.[key] ?? '';
  return baseline?.[key] === value ? tr(value) : value;
}
