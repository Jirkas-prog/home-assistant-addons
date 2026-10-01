// Numeric Excel-style expressions. No JavaScript evaluation or external references.
const aliases = {
  SUMA: 'SUM',
  PRUMER: 'AVERAGE',
  POCET: 'COUNT',
  SOUCIN: 'PRODUCT',
  KDYZ: 'IF',
  ZAOKROUHLIT: 'ROUND',
  'ZAOKR.NAHORU': 'ROUNDUP',
  'ZAOKR.DOLU': 'ROUNDDOWN',
  ODMOCNINA: 'SQRT',
  MOCNINA: 'POWER',
  'CELA.CAST': 'INT',
  RADIANY: 'RADIANS',
  STUPNE: 'DEGREES',
  FAKTORIAL: 'FACT',
  PRAVDA: 'TRUE',
  NEPRAVDA: 'FALSE',
  A: 'AND',
  NEBO: 'OR',
  NE: 'NOT'
};
const arity = {
  SUM: [1, 200],
  AVERAGE: [1, 200],
  COUNT: [1, 200],
  PRODUCT: [1, 200],
  MIN: [1, 200],
  MAX: [1, 200],
  IF: [3, 3],
  IFERROR: [2, 2],
  ROUND: [2, 2],
  ROUNDUP: [2, 2],
  ROUNDDOWN: [2, 2],
  ABS: [1, 1],
  SQRT: [1, 1],
  POWER: [2, 2],
  INT: [1, 1],
  TRUNC: [1, 1],
  MOD: [2, 2],
  PI: [0, 0],
  EXP: [1, 1],
  LN: [1, 1],
  LOG: [1, 2],
  LOG10: [1, 1],
  SIN: [1, 1],
  COS: [1, 1],
  TAN: [1, 1],
  ASIN: [1, 1],
  ACOS: [1, 1],
  ATAN: [1, 1],
  RADIANS: [1, 1],
  DEGREES: [1, 1],
  FACT: [1, 1],
  AND: [1, 200],
  OR: [1, 200],
  NOT: [1, 1]
};
const canonical = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const error = m => {
  throw Error(m);
};
const finite = n => Number.isFinite(n) ? Object.is(n, -0) ? 0 : n : error("The result is not a final number. Check the values ​​and scope of the function.");
export function numeric(value) {
  if (typeof value === 'number') return finite(value);
  const text = String(value ?? '').trim().replaceAll('\u00a0', '').replaceAll(' ', '');
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(text)) error("Please enter a valid number.");
  return finite(Number(text.replace(',', '.')));
}
export function compileFormula(source, references) {
  if (typeof source !== 'string' || source.length > 4000 || !source.trim()) error("Fill in the formula (maximum 4000 characters).");
  let s = source.trim().replace(/^=/, '').replaceAll('−', '-').replaceAll('×', '*').replaceAll('÷', '/'),
    tokens = [],
    pos = 0,
    depth = 0;
  while (pos < s.length) {
    if (/\s/.test(s[pos])) {
      pos++;
      continue;
    }
    const rest = s.slice(pos),
      num = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?/.exec(rest),
      name = /^[\p{L}_][\p{L}\d_.]*/u.exec(rest),
      op = /^(?:<=|>=|<>|[+\-*/^%()=:;<>])/.exec(rest);
    if (num) {
      tokens.push({
        kind: 'number',
        value: finite(Number(num[0].replace(',', '.')))
      });
      pos += num[0].length;
    } else if (name) {
      tokens.push({
        kind: 'name',
        value: canonical(name[0])
      });
      pos += name[0].length;
    } else if (op) {
      tokens.push({
        kind: op[0]
      });
      pos += op[0].length;
    } else error("Illegal character in position formula " + (pos + 1) + ". Separate function arguments with a semicolon.");
    if (tokens.length > 1800) error("The formula is too complicated.");
  }
  tokens.push({
    kind: 'end'
  });
  let at = 0;
  const take = k => tokens[at].kind === k ? (at++, true) : false,
    expect = k => {
      if (!take(k)) error("The formula is missing \"" + k + '“.');
    };
  const checkRef = name => {
    if (references && !references.includes(name)) error("Unknown field in formula: " + name);
    if (!/^(?:A[1-9]\d*|ANS|M)$/.test(name)) error("Unknown variable: " + name);
  };
  function atom() {
    if (++depth > 48) error("The formula is too deeply nested.");
    let node;
    const t = tokens[at++];
    if (t.kind === 'number') node = {
      type: 'number',
      value: t.value
    };else if (t.kind === '(') {
      node = comparison();
      expect(')');
    } else if (t.kind === 'name') {
      const name = aliases[t.value] || t.value;
      if (take('(')) {
        if (!Object.hasOwn(arity, name)) error("Unsupported feature: " + t.value);
        const args = [];
        if (!take(')')) {
          do {
            args.push(comparison());
          } while (take(';'));
          expect(')');
        }
        const [min, max] = arity[name];
        if (args.length < min || args.length > max) error('Funkce ' + t.value + " has an incorrect number of arguments.");
        node = {
          type: 'call',
          name,
          args
        };
      } else if (['PI', 'E', 'TRUE', 'FALSE'].includes(name)) node = {
        type: 'number',
        value: {
          PI: Math.PI,
          E: Math.E,
          TRUE: 1,
          FALSE: 0
        }[name]
      };else {
        checkRef(name);
        if (take(':')) {
          const end = tokens[at++];
          if (end.kind !== 'name' || !/^A[1-9]\d*$/.test(name) || !/^A[1-9]\d*$/.test(end.value)) error("Invalid range of fields.");
          const a = +name.slice(1),
            b = +end.value.slice(1);
          if (b < a || b - a >= 200) error("The range of fields is invalid or too large.");
          const names = Array.from({
            length: b - a + 1
          }, (_, i) => 'A' + (a + i));
          names.forEach(checkRef);
          node = {
            type: 'range',
            names
          };
        } else node = {
          type: 'ref',
          name
        };
      }
    } else error("The formula expects a number, array, or function.");
    depth--;
    return node;
  }
  function unary() {
    if (take('+')) {
      if (++depth > 48) error("The formula is too deep.");
      const n = unary();
      depth--;
      return n;
    }
    if (take('-')) {
      if (++depth > 48) error("The formula is too deep.");
      const n = {
        type: 'unary',
        node: unary()
      };
      depth--;
      return n;
    }
    return atom();
  }
  function percent() {
    let n = unary();
    while (take('%')) n = {
      type: 'binary',
      op: '/',
      left: n,
      right: {
        type: 'number',
        value: 100
      }
    };
    return n;
  }
  function chain(next, ops) {
    let n = next();
    while (ops.includes(tokens[at].kind)) {
      const op = tokens[at++].kind;
      n = {
        type: 'binary',
        op,
        left: n,
        right: next()
      };
    }
    return n;
  }
  const power = () => chain(percent, ['^']),
    multiply = () => chain(power, ['*', '/']),
    add = () => chain(multiply, ['+', '-']),
    comparison = () => chain(add, ['=', '<>', '<', '>', '<=', '>=']);
  const ast = comparison();
  if (tokens[at].kind !== 'end') error("An unexpected end to the formula. Check the parentheses and separators.");
  return ast;
}
function rounded(n, d, mode) {
  if (!Number.isInteger(d) || Math.abs(d) > 15) error("The number of decimal places must be an integer from −15 to 15.");
  const factor = 10 ** d,
    value = Math.abs(n) * factor;
  if (!Number.isFinite(value)) error("The number is too large to round.");
  const tolerance = Math.min(1e-7, Number.EPSILON * value * 2);
  const snapped = Math.abs(value - Math.round(value)) <= tolerance ? Math.round(value) : value;
  return finite(Math.sign(n) * (mode === 'up' ? Math.ceil(snapped) : mode === 'down' ? Math.floor(snapped) : Math.floor(value + .5 + tolerance)) / factor);
}
export function evaluateFormula(source, values = {}, options = {}) {
  const ast = typeof source === 'string' ? compileFormula(source, Object.keys(values)) : source;
  let budget = 10000;
  const one = v => Array.isArray(v) ? error("Use a field range inside SUM, AVERAGE, MIN, or MAX.") : v;
  const get = name => Object.hasOwn(values, name) ? numeric(values[name]) : error("A field value is missing " + name + '.');
  function run(n) {
    if (--budget < 0) error("The calculation is too complicated.");
    if (n.type === 'number') return n.value;
    if (n.type === 'ref') return get(n.name);
    if (n.type === 'range') return n.names.map(get);
    if (n.type === 'unary') return finite(-one(run(n.node)));
    if (n.type === 'binary') {
      const a = one(run(n.left)),
        b = one(run(n.right));
      return finite(n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? b === 0 ? error("Cannot be divided by zero.") : a / b : n.op === '^' ? a ** b : n.op === '=' ? +(a === b) : n.op === '<>' ? +(a !== b) : n.op === '<' ? +(a < b) : n.op === '>' ? +(a > b) : n.op === '<=' ? +(a <= b) : +(a >= b));
    }
    const name = n.name;
    if (name === 'IF') return run(n.args[one(run(n.args[0])) ? 1 : 2]);
    if (name === 'IFERROR') {
      try {
        return run(n.args[0]);
      } catch {
        return run(n.args[1]);
      }
    }
    const raw = n.args.map(run),
      aggregate = ['SUM', 'AVERAGE', 'COUNT', 'PRODUCT', 'MIN', 'MAX', 'AND', 'OR'].includes(name),
      a = aggregate ? raw.flat() : raw.map(one),
      x = a[0],
      y = a[1],
      rad = options.angle === 'deg' ? Math.PI / 180 : 1;
    let r;
    switch (name) {
      case 'SUM':
        r = a.reduce((x, y) => x + y, 0);
        break;
      case 'AVERAGE':
        r = a.reduce((x, y) => x + y, 0) / a.length;
        break;
      case 'COUNT':
        r = a.length;
        break;
      case 'PRODUCT':
        r = a.reduce((x, y) => x * y, 1);
        break;
      case 'MIN':
        r = Math.min(...a);
        break;
      case 'MAX':
        r = Math.max(...a);
        break;
      case 'ROUND':
        r = rounded(x, y);
        break;
      case 'ROUNDUP':
        r = rounded(x, y, 'up');
        break;
      case 'ROUNDDOWN':
        r = rounded(x, y, 'down');
        break;
      case 'ABS':
        r = Math.abs(x);
        break;
      case 'SQRT':
        r = Math.sqrt(x);
        break;
      case 'POWER':
        r = x ** y;
        break;
      case 'INT':
        r = Math.floor(x);
        break;
      case 'TRUNC':
        r = Math.trunc(x);
        break;
      case 'MOD':
        if (y === 0) error("Cannot be divided by zero.");
        r = x - y * Math.floor(x / y);
        break;
      case 'PI':
        r = Math.PI;
        break;
      case 'EXP':
        r = Math.exp(x);
        break;
      case 'LN':
        r = Math.log(x);
        break;
      case 'LOG':
        if ((y ?? 10) <= 0 || y === 1) error("The base of the logarithm must be positive and different from 1.");
        r = Math.log(x) / Math.log(y ?? 10);
        break;
      case 'LOG10':
        r = Math.log10(x);
        break;
      case 'SIN':
        r = Math.sin(x * rad);
        break;
      case 'COS':
        r = Math.cos(x * rad);
        break;
      case 'TAN':
        if (Math.abs(Math.cos(x * rad)) < 1e-14) error("Tangent is not defined for this angle.");
        r = Math.tan(x * rad);
        break;
      case 'ASIN':
        r = Math.asin(x) / rad;
        break;
      case 'ACOS':
        r = Math.acos(x) / rad;
        break;
      case 'ATAN':
        r = Math.atan(x) / rad;
        break;
      case 'RADIANS':
        r = x * Math.PI / 180;
        break;
      case 'DEGREES':
        r = x * 180 / Math.PI;
        break;
      case 'FACT':
        if (!Number.isInteger(x) || x < 0 || x > 170) error("Factorial requires an integer from 0 to 170.");
        r = 1;
        for (let i = 2; i <= x; i++) r *= i;
        break;
      case 'AND':
        r = +a.every(Boolean);
        break;
      case 'OR':
        r = +a.some(Boolean);
        break;
      case 'NOT':
        r = +!x;
        break;
      default:
        error("Unsupported feature.");
    }
    return finite(r);
  }
  return finite(one(run(ast)));
}
export const formulaHelp = "Fields: A1, A2… • + − * / ^ % • parentheses • decimal point or comma • separate arguments with ;. Functions: SUM, AVERAGE, MIN, MAX, PRODUCT, COUNT, IF, IFERROR, ROUND, ROUNDUP, ROUNDDOWN, ABS, SQRT, POWER, INT, TRUNC, MOD, PI, SIN, COS, TAN, ASIN, ACOS, ATAN, LN, LOG, LOG10, EXP, RADIANS, DEGREES, FACT, AND, OR, NOT. Range example: SUM(A1:A3).";
