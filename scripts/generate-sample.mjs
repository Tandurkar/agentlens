// Generates a realistic sample trace: a coding agent chasing a rounding bug.
// Usage: node scripts/generate-sample.mjs [--repeat N] [--out path]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const flag = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const repeat = Math.max(1, Number(flag('--repeat', '1')));
const outPath = flag('--out', 'public/samples/bugfix-session.jsonl');

// deterministic PRNG so the sample is reproducible
let seed = 0x5eed;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const MODEL = 'claude-sonnet-5';
let ts = Date.parse('2026-10-02T09:12:00Z');
const events = [];
const push = (e) => events.push(e);
const adv = (lo, hi = lo + 1) => {
  ts += lo + Math.floor(rand() * (hi - lo));
};

const chunks = (s, lo, hi) => {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const n = lo + Math.floor(rand() * (hi - lo));
    out.push(s.slice(i, i + n));
    i += n;
  }
  return out;
};

let outChars = 0;
let toolSeq = 0;
let inputTokens = 2800;

const text = (s) => {
  for (const c of chunks(s, 4, 10)) {
    adv(18, 48);
    push({ type: 'text_delta', ts, text: c });
  }
  outChars += s.length;
};

const thinking = (s) => {
  for (const c of chunks(s, 5, 12)) {
    adv(12, 35);
    push({ type: 'thinking_delta', ts, text: c });
  }
  outChars += s.length;
};

const tool = (name, input, { durMs, ok = true, result }) => {
  const id = `tu_${String(++toolSeq).padStart(2, '0')}`;
  adv(60, 160);
  push({ type: 'tool_use_start', ts, id, name });
  const json = JSON.stringify(input);
  for (const c of chunks(json, 8, 18)) {
    adv(8, 24);
    push({ type: 'tool_input_delta', ts, id, partial_json: c });
  }
  adv(5, 15);
  push({ type: 'tool_use_stop', ts, id });
  const started = ts;
  adv(durMs);
  push({ type: 'tool_result', ts, id, ok, content: result, duration_ms: ts - started });
  outChars += json.length;
};

const turn = (fn) => {
  adv(200, 500);
  push({ type: 'message_start', ts, model: MODEL });
  outChars = 0;
  fn();
  const out = Math.max(1, Math.round(outChars / 3.8));
  inputTokens += 900 + Math.floor(rand() * 600) + out;
  adv(40, 90);
  push({
    type: 'message_stop',
    ts,
    usage: { input_tokens: inputTokens, output_tokens: out },
    cost_usd: Number((inputTokens * 3e-6 + out * 15e-6).toFixed(6)),
    stop_reason: 'end_turn',
  });
};

const TOTAL_TS = `import type { CartItem } from './types';

export function cartTotal(items: CartItem[]): number {
  let total = 0;
  for (const item of items) {
    // round each line to cents before summing
    const lineTotal = Number((item.price * item.qty).toFixed(2));
    total += lineTotal;
  }
  return Number(total.toFixed(2));
}
`;

const TEST_TS = `import { describe, expect, it } from 'vitest';
import { cartTotal } from './total';

describe('cartTotal', () => {
  it('rounds line totals', () => {
    expect(cartTotal([{ price: 1.1, qty: 3 }])) .toBe(3.3);
  });
  it('sums many small lines without drift', () => {
    const items = Array.from({ length: 70 }, () => ({ price: 0.07, qty: 1 }));
    expect(cartTotal(items)).toBe(4.9);
  });
});
`;

const DISCOUNT_TS = `import type { CartItem } from './types';

export function discountedTotal(items: CartItem[], pct: number): number {
  let total = 0;
  for (const item of items) {
    const line = Number((item.price * item.qty * (1 - pct)).toFixed(2));
    total += line;
  }
  return Number(total.toFixed(2));
}
`;

function story() {
  push({
    type: 'trace_meta',
    ts,
    agent: 'repo-fixer',
    model: MODEL,
    title: 'Fix cart rounding drift',
  });
  adv(300, 600);
  push({
    type: 'user_message',
    ts,
    text: 'Checkout totals are sometimes a cent off — e.g. 70 items at 0.07 € shows 4.90 € in one place and 4.89 € in another. The test "cartTotal › sums many small lines without drift" is flaky in CI. Find the cause and fix it.',
  });

  turn(() => {
    thinking(
      'A cent of drift between two totals almost always means floating-point money math. The classic failure: rounding each line to cents with toFixed and then summing the rounded floats, versus summing raw floats and rounding once. 70 × 0.07 is exactly the kind of input that exposes it, since 0.07 has no exact binary representation. I should read the total logic first, then check where else the codebase rounds with toFixed, then look at the failing test before touching anything.',
    );
    text("I'll start with the cart total logic and the failing test, then check where else rounding happens.");
    tool('read_file', { path: 'src/cart/total.ts' }, { durMs: 142, result: TOTAL_TS });
    tool(
      'grep',
      { pattern: 'toFixed', glob: 'src/**/*.ts' },
      {
        durMs: 97,
        result:
          'src/cart/total.ts:6:    const lineTotal = Number((item.price * item.qty).toFixed(2));\nsrc/cart/total.ts:9:  return Number(total.toFixed(2));\nsrc/cart/discount.ts:6:    const line = Number((item.price * item.qty * (1 - pct)).toFixed(2));\nsrc/ui/Price.tsx:12:  return <span>{value.toFixed(2)} €</span>;',
      },
    );
    tool('read_file', { path: 'src/cart/total.test.ts' }, { durMs: 128, result: TEST_TS });
  });

  turn(() => {
    thinking(
      'Confirmed. total.ts rounds every line to cents and accumulates the rounded floats — each line can be off by up to half a cent, and 70 lines of 0.07 drift visibly. The robust fix is integer cents: convert each line to cents with one Math.round, sum integers, divide once at the end. The grep shows discount.ts has the same per-line rounding pattern, so fixing only total.ts will leave the two paths disagreeing — which is exactly the "one place says 4.90, another 4.89" symptom. Fix both.',
    );
    text(
      'Found it. `cartTotal` rounds every line to cents and then sums the rounded floats, so drift accumulates — and `discountedTotal` has the same pattern, which is why two screens can disagree. I’ll switch both to integer-cent arithmetic: round each line to whole cents once, sum integers, convert back at the end.',
    );
    tool(
      'edit_file',
      {
        path: 'src/cart/total.ts',
        old: 'let total = 0;\n  for (const item of items) {\n    // round each line to cents before summing\n    const lineTotal = Number((item.price * item.qty).toFixed(2));\n    total += lineTotal;\n  }\n  return Number(total.toFixed(2));',
        new: 'let cents = 0;\n  for (const item of items) {\n    cents += Math.round(item.price * item.qty * 100);\n  }\n  return cents / 100;',
      },
      { durMs: 231, result: 'Applied 1 edit to src/cart/total.ts.' },
    );
    tool(
      'run_tests',
      { filter: 'cart' },
      {
        durMs: 6418,
        ok: false,
        result:
          'FAIL  src/cart/discount.test.ts > discountedTotal > matches cartTotal for pct=0\n  AssertionError: expected 4.89 to be 4.9\n    at src/cart/discount.test.ts:14:38\n\nTest Files  1 failed | 2 passed (3)\nTests  1 failed | 40 passed (41)\nDuration  6.42s',
      },
    );
  });

  push({ type: 'error', ts: (adv(400, 700), ts), message: 'API error 529 (overloaded_error) while starting turn' });
  push({ type: 'retry', ts: (adv(900, 1400), ts), attempt: 1, reason: 'backoff 1s, then retry' });

  turn(() => {
    text('As expected, the discount path still drifts — it kept the per-line float rounding. Applying the same integer-cent fix there.');
    tool('read_file', { path: 'src/cart/discount.ts' }, { durMs: 118, result: DISCOUNT_TS });
    tool(
      'edit_file',
      {
        path: 'src/cart/discount.ts',
        old: 'let total = 0;\n  for (const item of items) {\n    const line = Number((item.price * item.qty * (1 - pct)).toFixed(2));\n    total += line;\n  }\n  return Number(total.toFixed(2));',
        new: 'let cents = 0;\n  for (const item of items) {\n    cents += Math.round(item.price * item.qty * (1 - pct) * 100);\n  }\n  return cents / 100;',
      },
      { durMs: 204, result: 'Applied 1 edit to src/cart/discount.ts.' },
    );
    tool(
      'run_tests',
      { filter: 'cart' },
      {
        durMs: 5731,
        result: 'Test Files  3 passed (3)\nTests  41 passed (41)\nDuration  5.73s',
      },
    );
  });

  turn(() => {
    text(
      'Done. The drift came from rounding every cart line to cents and summing the rounded floats — half-cent errors accumulated across lines, and the discount path rounded independently, so two screens could disagree by a cent.\n\nFix: both `cartTotal` and `discountedTotal` now work in integer cents (one Math.round per line, integer sum, divide once at the end). All 41 tests pass, including the 70×0.07 drift case.\n\nWorth a follow-up: `src/ui/Price.tsx` formats with toFixed, which is fine for display — but consider a shared `formatCents` helper so money never exists as a float outside these two functions.',
    );
  });
}

for (let r = 0; r < repeat; r++) {
  story();
  adv(5000, 9000);
}

mkdirSync(dirname(outPath), { recursive: true });
const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
writeFileSync(outPath, lines);

const durationS = ((events[events.length - 1].ts - events[0].ts) / 1000).toFixed(1);
console.log(
  `wrote ${outPath}: ${events.length} events, ${durationS}s of agent time, ${(lines.length / 1024).toFixed(0)} KiB`,
);
