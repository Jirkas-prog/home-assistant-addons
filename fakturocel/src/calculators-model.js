import { compileFormula, evaluateFormula, numeric } from './formula.js';
const field = (n, label, unit = '', value = 0, min = 0) => ({
  ref: 'A' + n,
  label,
  unit,
  default: value,
  ...(min === null ? {} : {
    min
  })
});
const output = (label, formula, unit = '', decimals = 2) => ({
  label,
  formula,
  unit,
  decimals
});
export const calculatorKinds = {
  basic: "Common",
  scientific: "Scientific",
  formula: "Formula"
};
export function defaultCalculators() {
  return [{
    id: 'calc-basic',
    name: "Standard calculator",
    kind: 'basic',
    enabled: true,
    description: "Basic calculations, percentages, memory and history."
  }, {
    id: 'calc-scientific',
    name: "Scientific calculator",
    kind: 'scientific',
    enabled: true,
    description: "Functions, powers, logarithms and angles in degrees or radians."
  }, {
    id: 'calc-print3d',
    name: '3D printing',
    kind: 'formula',
    enabled: true,
    description: "Costs and price of the entire order. Enter your own consumption and rates; the result does not include a separate VAT calculation.",
    fields: [field(1, "Total material", 'g'), field(2, "Material price", "CZK/kg"), field(3, "Total printing time", 'hours'), field(4, "Average printer power consumption", 'W'), field(5, "Electricity price", "CZK/kWh"), field(6, "Printer operation and wear", "CZK/hour"), field(7, "Preparation and completion", 'min'), field(8, "Labour rate", "CZK/hour"), field(9, "Other costs", "CZK"), field(10, "Material reserve", '%'), field(11, "Cost markup", '%'), field(12, "Number of pieces", 'pcs', 1, 1)],
    results: [output("Order price", '=ROUND((A1/1000*A2*(1+A10/100)+A3*(A4/1000*A5+A6)+A7/60*A8+A9)*(1+A11/100);2)', "CZK"), output("Price per piece", '=ROUND((A1/1000*A2*(1+A10/100)+A3*(A4/1000*A5+A6)+A7/60*A8+A9)*(1+A11/100)/A12;2)', "CZK/pc"), output("Material with reserve", '=A1/1000*A2*(1+A10/100)', "CZK"), output("Electricity", '=A3*A4/1000*A5', "CZK"), output("Printer operation", '=A3*A6', "CZK"), output("Work", '=A7/60*A8', "CZK")]
  }, {
    id: 'calc-percent',
    name: 'Percentage and discount',
    kind: 'formula',
    enabled: true,
    description: "How much is the entered percentage, price after discount and increase.",
    fields: [field(1, "Base value", '', 0, null), field(2, 'Percentage', '%', 0, null)],
    results: [output("The percentage part", '=A1*A2/100'), output("After subtraction", '=A1*(1-A2/100)'), output("After adding", '=A1*(1+A2/100)')]
  }, {
    id: 'calc-price',
    name: "Margin and markup",
    kind: 'formula',
    enabled: true,
    description: "Margin is a share of the selling price; markup is a share of the cost. The entered percentage is used separately for both methods.",
    fields: [field(1, "Costs", "CZK"), {
      ...field(2, "Required percentage", '%'),
      max: 99.99
    }],
    results: [output("Price with specified margin", '=ROUND(A1/(1-A2/100);2)', "CZK"), output("Price with specified markup", '=ROUND(A1*(1+A2/100);2)', "CZK")]
  }, {
    id: 'calc-energy',
    name: "Electricity consumption",
    kind: 'formula',
    enabled: true,
    description: "Approximate costs according to average power consumption and operating time.",
    fields: [field(1, "Power consumption", 'W'), field(2, 'Operating time per day', 'hours'), field(3, "Number of days", "days", 1), field(4, "Electricity price", "CZK/kWh")],
    results: [output("Cost of operation", '=A1/1000*A2*A3*A4', "CZK"), output("Consumption", '=A1/1000*A2*A3', 'kWh', 3)]
  }];
}
export const calculatorsValue = value => structuredClone(value ?? defaultCalculators());
export function validateCalculators(value) {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.length || value.length > 100) throw Error("The list must contain 1 to 100 calculators.");
  const ids = new Set();
  for (const c of value) {
    if (!c || typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) || ids.has(c.id)) throw Error("Invalid or duplicate ID calculators.");
    ids.add(c.id);
    if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 100 || typeof c.description !== 'string' || c.description.length > 1500 || typeof c.enabled !== 'boolean' || !Object.hasOwn(calculatorKinds, c.kind)) throw Error("Fill in the name and valid settings of the calculator.");
    if (c.kind !== 'formula') continue;
    if (c.nextRef !== undefined && (!Number.isInteger(c.nextRef) || c.nextRef < 1 || c.nextRef > 100000)) throw Error("Invalid order of number fields.");
    if (!Array.isArray(c.fields) || c.fields.length < 1 || c.fields.length > 200 || !Array.isArray(c.results) || c.results.length < 1 || c.results.length > 20) throw Error("The calculator needs 1 to 200 number fields and 1 to 20 results.");
    const refs = new Set();
    for (const f of c.fields) {
      if (!/^A[1-9]\d{0,4}$/.test(f.ref) || refs.has(f.ref) || typeof f.label !== 'string' || !f.label.trim() || f.label.length > 100 || typeof f.unit !== 'string' || f.unit.length > 32) throw Error("Each field needs a unique reference A1, A2… and a description.");
      refs.add(f.ref);
      const v = numeric(f.default);
      for (const k of ['min', 'max']) if (f[k] !== undefined) numeric(f[k]);
      if (f.min !== undefined && v < numeric(f.min) || f.max !== undefined && v > numeric(f.max) || f.min !== undefined && f.max !== undefined && numeric(f.min) > numeric(f.max)) throw Error('The default value for field "' + f.label + '" is outside the allowed range.');
    }
    for (const r of c.results) {
      if (typeof r.label !== 'string' || !r.label.trim() || r.label.length > 100 || typeof r.unit !== 'string' || r.unit.length > 32 || !Number.isInteger(r.decimals) || r.decimals < 0 || r.decimals > 10) throw Error("Complete the description of the result and 0 to 10 decimal places.");
      try {
        compileFormula(r.formula, [...refs]);
      } catch (e) {
        throw Error(c.name + ' / ' + r.label + ': ' + e.message);
      }
    }
  }
  if (!value.some(c => c.enabled)) throw Error("Leave at least one calculator on.");
}
export function calculateFields(calculator, inputs = {}) {
  const values = {};
  for (const f of calculator.fields) {
    let v;
    try {
      v = numeric(inputs[f.ref] ?? f.default);
    } catch {
      throw Error('Field "' + f.label + '": enter a number.');
    }
    if (f.min !== undefined && v < numeric(f.min) || f.max !== undefined && v > numeric(f.max)) throw Error('Field "' + f.label + '" is outside the allowed range.');
    values[f.ref] = v;
  }
  return calculator.results.map(r => {
    try {
      return {
        ...r,
        value: evaluateFormula(r.formula, values)
      };
    } catch (e) {
      return {
        ...r,
        error: e.message
      };
    }
  });
}
export function displayNumber(n, decimals) {
  if (!Number.isFinite(n)) return '—';
  const value = Number(n.toPrecision(14));
  const locale = typeof document !== 'undefined' && document.documentElement?.lang === 'cs' ? 'cs-CZ' : 'en-GB';
  return decimals === undefined ? value !== 0 && (Math.abs(value) < 1e-8 || Math.abs(value) >= 1e14) ? value.toExponential(10) : new Intl.NumberFormat(locale, {
    maximumFractionDigits: 12
  }).format(value) : new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}
