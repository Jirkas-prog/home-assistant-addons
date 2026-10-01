import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileFormula, evaluateFormula, numeric } from '../src/formula.js';
import { defaultCalculators, validateCalculators, calculateFields } from '../src/calculators-model.js';
import { emptyState, packBackup, unpackBackup, validateState } from '../src/model.js';
import { Store } from '../server/store.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const near = (a, b) => assert(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
test('Excel-style numeric formulas: English input, precedence, functions, ranges and lazy conditions', () => {
  assert.equal(evaluateFormula('=2+3*4'), 14);
  assert.equal(evaluateFormula('=-2^2'), 4);
  assert.equal(evaluateFormula('=-(2^2)'), -4);
  assert.equal(evaluateFormula('=2^3^2'), 64);
  near(evaluateFormula('1,5*2.4'), 3.6);
  assert.equal(evaluateFormula('200*10%'), 20);
  assert.equal(evaluateFormula('3−1×2'), 1);
  assert.equal(evaluateFormula('=ROUND(SUM(A1:A3)*1,2;2)', {
    A1: 10,
    A2: 15,
    A3: 5
  }), 36);
  assert.equal(evaluateFormula("AVERAGE(A1;A2)", {
    A1: 10,
    A2: 20
  }), 15);
  assert.equal(evaluateFormula("IF(A1=0;0;1/A1)", {
    A1: 0
  }), 0);
  assert.equal(evaluateFormula('IFERROR(1/0;42)'), 42);
  assert.equal(evaluateFormula("IF(AND(1<2;3>=3);MAX(2;9);0)"), 9);
  assert.equal(evaluateFormula('ROUND(-1.005;2)'), -1.01);
  assert.equal(evaluateFormula('ROUND(1000000000000000;0)'), 1e15);
  assert.equal(evaluateFormula('ROUNDUP(-1.21;1)'), -1.3);
  assert.equal(evaluateFormula('ROUNDDOWN(-1.29;1)'), -1.2);
  assert.equal(evaluateFormula('ROUNDUP(1.1+2.2;1)'), 3.3);
  assert.equal(evaluateFormula('ROUNDDOWN(0.3-0.2;1)'), 0.1);
  assert.equal(evaluateFormula('MOD(-3;2)'), 1);
  assert.equal(evaluateFormula('2E3+ANS+M', {
    ANS: 2,
    M: 3
  }), 2005);
  assert.equal(numeric('1 234,50'), 1234.5);
});
test('scientific calculations support explicit angle modes and reject undefined or overflowing results', () => {
  near(evaluateFormula('SIN(30)', {}, {
    angle: 'deg'
  }), .5);
  near(evaluateFormula('SIN(PI()/2)'), 1);
  near(evaluateFormula('ASIN(0.5)', {}, {
    angle: 'deg'
  }), 30);
  near(evaluateFormula('LOG(100)'), 2);
  near(evaluateFormula('LOG(8;2)'), 3);
  assert.equal(evaluateFormula('FACT(5)'), 120);
  near(evaluateFormula('DEGREES(RADIANS(45))'), 45);
  for (const formula of ['1/0', 'SQRT(-1)', 'LN(0)', 'LOG(2;1)', 'FACT(171)', 'FACT(-1)', 'EXP(1000)', 'ROUND(1;100)', '1e999']) assert.throws(() => evaluateFormula(formula));
  assert.throws(() => evaluateFormula('TAN(90)', {}, {
    angle: 'deg'
  }), /defined/);
});
test('formula parser rejects code, unavailable references, invalid arguments and excessive complexity', () => {
  for (const formula of ['alert(1)', 'globalThis.x', 'constructor.constructor(1)', 'fetch(1)', '[1]', '1;2', '1||2', '1&&2', '"x"', 'SUM()', 'ROUND(1)', "IF(1;2)", '1 2', 'SUM(A1:A300)', 'A0', 'A1.constructor', '2(3+4)', 'SUM(A2:A1)', 'SUM(A1:A3)']) assert.throws(() => compileFormula(formula, ['A1', 'A2']));
  assert.throws(() => compileFormula('1'.repeat(4001)));
  assert.throws(() => compileFormula('('.repeat(100) + '1' + ')'.repeat(100)));
  assert.throws(() => compileFormula('-'.repeat(100) + '1'));
  assert.throws(() => compileFormula('1+'.repeat(1000) + '1'));
  assert.throws(() => numeric('Infinity'));
  assert.throws(() => numeric(''));
  assert.equal(globalThis.calculatorInjected, undefined);
});
test('3D printing includes material reserve, energy, machine, labour, extras and markup without double multiplying quantity', () => {
  const c = defaultCalculators().find(c => c.id === 'calc-print3d');
  const r = calculateFields(c, {
    A1: 100,
    A2: 500,
    A3: 2,
    A4: 200,
    A5: 6,
    A6: 10,
    A7: 30,
    A8: 300,
    A9: 20,
    A10: 10,
    A11: 20,
    A12: 2
  });
  const value = label => r.find(x => x.label === label).value;
  assert.equal(value("Material with reserve"), 55.00000000000001);
  near(value("Electricity"), 2.4);
  near(value("Printer operation"), 20);
  near(value("Work"), 150);
  near(value("Order price"), 296.88);
  near(value("Price per piece"), 148.44);
  assert.throws(() => calculateFields(c, {
    A12: 0
  }), /range/);
  assert.throws(() => calculateFields(c, {
    A1: ''
  }), /number/);
});
test('calculator definitions, reference stability, ordering and full backup survive reload; legacy states remain valid', async () => {
  const s = emptyState();
  validateCalculators(s.settings.calculators);
  const original = s.settings.calculators;
  s.settings.calculators = [original[2], ...original.slice(0, 2), ...original.slice(3), {
    id: 'custom',
    kind: 'formula',
    name: "Own",
    description: 'Test',
    enabled: true,
    fields: [{
      ref: 'A1',
      label: "Work",
      unit: 'hours',
      default: 2
    }, {
      ref: 'A3',
      label: 'Rate',
      unit: "CZK",
      default: 100
    }],
    results: [{
      label: "Price",
      formula: '=A1*A3',
      unit: "CZK",
      decimals: 2
    }]
  }];
  const backup = await packBackup(s, {}),
    restored = (await unpackBackup(backup)).data;
  assert.deepEqual(restored.settings.calculators, s.settings.calculators);
  assert.equal(calculateFields(restored.settings.calculators.at(-1))[0].value, 200);
  for (const mutate of [c => c[0].results[0].formula = '=A999', c => c[0].fields[1].ref = 'A1', c => c.forEach(x => x.enabled = false), c => c[0].results[0].decimals = 30, c => c[0].fields[0].default = 'bad', c => c[0].fields[0].min = 99, c => c.push(c[0])]) {
    const invalid = structuredClone(s.settings.calculators);
    mutate(invalid);
    assert.throws(() => validateCalculators(invalid));
  }
  delete s.settings.calculators;
  validateState(s);
  assert.equal((await unpackBackup(await packBackup(s, {}))).data.settings.calculators, undefined);
});
test('server validates calculator configuration and readers cannot change shared calculators', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "fakturocel-calculators-")),
    store = new Store({
      root: path.join(base, 'data'),
      shareRoot: path.join(base, 'share'),
      backupFolder: path.join(base, 'share', 'backups')
    });
  try {
    await store.init();
    const actor = store.actor('owner', 'Owner');
    store.setMeta('roles', {
      owner: {
        name: 'Owner',
        role: 'owner'
      },
      reader: {
        name: 'Reader',
        role: 'reader'
      }
    });
    const before = store.read(),
      state = structuredClone(before.state);
    state.settings.calculators[2].results[0].formula = '=fetch(1)';
    const input = {
      ops: [{
        collection: 'config',
        rev: before.configRevision,
        value: {
          supplier: state.supplier,
          settings: state.settings
        }
      }]
    };
    await assert.rejects(store.commit(input, actor), /feature|function/i);
    assert.deepEqual(store.read().state, before.state);
    input.ops[0].value.settings.calculators = defaultCalculators().reverse();
    await assert.rejects(store.commit(input, store.actor('reader', 'Reader')), e => e.status === 403);
    await store.commit(input, actor);
    assert.equal(store.read().state.settings.calculators[0].id, 'calc-energy');
  } finally {
    store.close();
  }
});
