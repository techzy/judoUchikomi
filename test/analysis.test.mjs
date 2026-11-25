// Tests for the rep-detection + scoring logic inside index.html.
// Run with: npm test   (or: node --test)
// No dependencies. The app's <script type="module"> is extracted from index.html,
// imported under Node (where it skips the browser-only main()), and exercised with
// synthetic skeletons that mimic MediaPipe Pose output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const js = html.split('<script type="module">')[1].split('</script>')[0];
const tmp = join(mkdtempSync(join(tmpdir(), 'uchikomi-')), 'app.mjs');
writeFileSync(tmp, js);
await import(pathToFileURL(tmp).href);
const { Analyzer, scoreRep, buildReference } = globalThis.__uchikomi;

const OPTS = { hand: 'right', calibMs: 1500, smooth: 0.35, enterDeg: 70, exitDeg: 40, minRepMs: 250, maxRepMs: 4000,
  scoreSweep: true, scorePull: true, goodScore: 90 };
const DT = 33; // ~30 fps

const P = (x, y, z = 0, v = 0.99) => ({ x, y, z, visibility: v });

// Synthetic pose. yaw: body turn (deg) · drop: hip drop (fraction of leg) · supBend/sweepBend: knee flexion (deg)
// sweepLift: sweep ankle height (fraction of leg) · pull: hikite wrist above shoulders (fraction of torso)
function pose({ yaw = 0, drop = 0, supBend = 5, sweepLift = 0, sweepBend = 5, pull = -0.3 } = {}, noise = 0.003) {
  const r = yaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), n = () => (Math.random() - 0.5) * noise;
  const w = Array.from({ length: 33 }, () => P(0, 0)), lm = Array.from({ length: 33 }, () => P(0.5, 0.5));
  const setW = (i, x, y, z) => { w[i] = P(x * c - z * s + n(), y + n(), x * s + z * c + n()); };
  setW(23, -0.1, 0, 0); setW(24, 0.1, 0, 0); setW(11, -0.18, -0.5, 0); setW(12, 0.18, -0.5, 0);
  const leg = (kneeI, ankI, hx, bend) => { const b = bend * Math.PI / 180; setW(kneeI, hx, 0.45, 0); setW(ankI, hx, 0.45 + 0.45 * Math.cos(b), -0.45 * Math.sin(b)); };
  leg(25, 27, -0.1, supBend); leg(26, 28, 0.1, sweepBend);
  const legLen = 0.36, hipY = 0.45 + drop * legLen, floor = 0.81;
  lm[23] = P(0.47, hipY + n()); lm[24] = P(0.53, hipY + n());
  lm[11] = P(0.47, hipY - 0.2); lm[12] = P(0.53, hipY - 0.2);
  lm[25] = P(0.47, (hipY + floor) / 2); lm[26] = P(0.53, (hipY + floor) / 2);
  lm[27] = P(0.47, floor); lm[28] = P(0.53, floor - sweepLift * legLen);
  lm[15] = P(0.45, hipY - 0.2 - pull * 0.2); lm[16] = P(0.55, hipY - 0.1);
  return { lm, w };
}

// Stand still to calibrate, then perform each rep: turn in → hold → turn out → rest.
function simulate(reps, opts = OPTS) {
  const A = new Analyzer(opts); const events = []; let t = 0;
  const step = p => { const { lm, w } = pose(p); const e = A.push(lm, w, t); if (e) events.push(e); t += DT; };
  for (let i = 0; i < 70; i++) step({});
  for (const R of reps) {
    for (let i = 0; i < 10; i++) { const k = i / 9; step({ yaw: R.yaw * k, drop: R.drop * k, supBend: 5 + (R.supBend - 5) * k, pull: -0.3 + (R.pull + 0.3) * k }); }
    for (let i = 0; i < (R.holdFrames ?? 10); i++) step({ yaw: R.yaw, drop: R.drop, supBend: R.supBend, sweepLift: R.lift, sweepBend: R.sweepBend, pull: R.pull });
    for (let i = 0; i < 10; i++) { const k = 1 - i / 9; step({ yaw: R.yaw * k, drop: R.drop * k, supBend: 5 + (R.supBend - 5) * k }); }
    for (let i = 0; i < 15; i++) step({});
  }
  return events;
}

const GOOD = { yaw: 170, drop: 0.18, supBend: 40, lift: 0.4, sweepBend: 8, pull: 0.1 };

test('calibrates after standing still', () => {
  const ev = simulate([]);
  assert.deepEqual(ev.map(e => e.type), ['calibrated']);
});

test('does not calibrate while bouncing', () => {
  const A = new Analyzer(OPTS); let calibrated = false;
  for (let i = 0; i < 200; i++) { const { lm, w } = pose({ drop: 0.1 * Math.sin(i / 3) }); if (A.push(lm, w, i * DT)) calibrated = true; }
  assert.equal(calibrated, false);
});

test('counts one rep per turn-in', () => {
  const reps = simulate([GOOD, GOOD, GOOD]).filter(e => e.type === 'rep');
  assert.equal(reps.length, 3);
});

test('measures the rep roughly correctly', () => {
  const m = simulate([GOOD]).find(e => e.type === 'rep').metrics;
  assert.ok(m.rotation > 155, `rotation ${m.rotation}`);
  assert.ok(Math.abs(m.hipDrop - 0.18) < 0.03, `hipDrop ${m.hipDrop}`);
  assert.ok(Math.abs(m.sweepHeight - 0.4) < 0.03, `sweepHeight ${m.sweepHeight}`);
  assert.ok(m.supportKnee < 150, `supportKnee ${m.supportKnee}`);
});

test('good rep gets no correction; high hips get "Hips lower"', () => {
  const [good, high] = simulate([GOOD, { ...GOOD, drop: 0.02 }]).filter(e => e.type === 'rep');
  const sGood = scoreRep(good.metrics, null, OPTS), sHigh = scoreRep(high.metrics, null, OPTS);
  assert.equal(sGood.cue, 'Good rep');
  assert.equal(sHigh.cue, 'Hips lower');
  assert.ok(sHigh.score < sGood.score);
});

test('reference makes under-rotation get "Turn in more"', () => {
  const reps = simulate([GOOD, GOOD, { ...GOOD, yaw: 120 }]).filter(e => e.type === 'rep');
  const ref = buildReference(reps.slice(0, 2).map(r => r.metrics));
  assert.equal(scoreRep(reps[2].metrics, ref, OPTS).cue, 'Turn in more');
});

test('a rep held longer than maxRepMs is discarded', () => {
  const ev = simulate([{ ...GOOD, holdFrames: 150 }]); // ~5 s
  assert.ok(ev.some(e => e.type === 'discard'));
  assert.equal(ev.filter(e => e.type === 'rep').length, 0);
});

test('turning off sweep scoring ignores the sweep', () => {
  const m = simulate([{ ...GOOD, lift: 0 }]).find(e => e.type === 'rep').metrics;
  assert.equal(scoreRep(m, null, { ...OPTS, scoreSweep: false }).cue, 'Good rep');
  assert.equal(scoreRep(m, null, OPTS).cue, 'Sweep higher');
});
