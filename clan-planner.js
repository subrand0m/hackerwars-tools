// clan-planner.js — entry point
'use strict';

// ──────────────────────────────────────────────────────────────────────
// Formulas (pure functions, no DOM, no state)
// ──────────────────────────────────────────────────────────────────────

// virusPercent: from earnings.md / earnings formula
// (version × 10 / 1000) × 2 + 1   →   v1.0 = 1.02, v10.0 = 1.20, v25.0 = 1.50
function virusPercent(version) {
  return (version * 10 / 1000) * 2 + 1;
}

// collectorBonus: flat +version% on totalMoney
// Source: legacy-master/classes/List.class.php:832
// v10.0 = 1.10×, v25.0 = 1.25×
function collectorBonus(collectorVersion) {
  return 1 + collectorVersion / 100;
}

// Earning-rate constants from .claude/context/earnings.md and dev-confirmed K_m
const WAREZ_RATE = 3.00;     // $/Mbit/hr (Fotoshop CS6 v3.0)
const SPAM_RATE  = 0.0501;   // $/MB/hr (RAM-based, dev-confirmed 2026-05-02)
const K_M        = 100;      // $/GHz/hr at v1.0 / collector v1.0 (dev-anchored 2026-05-12)

// NPC-stolen virus baseline. Highest pre-installed version found on NPC servers
// per the round NPC spreadsheet — research investment for the "total break-even"
// line is measured from this version upward (below it is free steal).
const NPC_BASE_VERSIONS = Object.freeze({
  warez: 14.0,   // Ultra Warez
  spam:  12.0,   // Ultra Spam
  miner: 15.0,   // Epic Miner
});

function warezPerHr(netMbit, version, collector) {
  return WAREZ_RATE * netMbit * virusPercent(version) * collectorBonus(collector);
}

function spamPerHr(ramMb, version, collector) {
  // No clan divisor — latest reading (clan log #17) supports RAM-model with no divisor.
  return SPAM_RATE * ramMb * virusPercent(version) * collectorBonus(collector);
}

function minerPerHr(cpuGhz, version, collector, k_m = K_M) {
  return k_m * cpuGhz * virusPercent(version) * collectorBonus(collector);
}

function minerBtcPerHr(cpuGhz, version, collector, btcPrice, k_m = K_M) {
  return minerPerHr(cpuGhz, version, collector, k_m) / btcPrice;
}

// ──────────────────────────────────────────────────────────────────────
// Hardware aggregation (max-stats-per-sub-PC assumption)
// ──────────────────────────────────────────────────────────────────────

// CPU tiers from FINDINGS.md:644-649 (shop). 500 MHz is the legacy floor
// (FINDINGS.md:464) and is what every freshly-bought server ships with — free.
// All other tiers replace the starter chip at the listed price.
const CPU_TIERS = [
  { mhz:  500, price:      0, label: '500 MHz (starter)' },
  { mhz: 3000, price:  1_500, label: 'Quad Core 3 GHz' },
  { mhz: 3500, price:  2_000, label: 'AMD FX 8350' },
  { mhz: 4000, price:  5_000, label: 'i7 4990k 4 GHz' },
  { mhz: 5000, price:  9_000, label: 'i7 11700k 5 GHz' },
  { mhz: 6000, price: 15_000, label: 'i9 13900k 6 GHz' },
];
const VALID_CPU_MHZ = CPU_TIERS.map(t => t.mhz);
const DEFAULT_CPU_MHZ = 6000;  // matches user's clan setup as of R70

// RAM tiers from FINDINGS.md:651-658 (shop). Alzheimer (256 MB) is starter and
// included free with any new server; the rest cost their listed price as a
// one-shot upgrade applied per sub-PC.
const RAM_TIERS = [
  { mb:   256, price:     0, label: 'Alzheimer 256 MB (starter)' },
  { mb:   512, price:    99, label: 'King Ton 512 MB' },
  { mb:  1024, price:   500, label: 'Cross 1G' },
  { mb:  2048, price: 2_500, label: 'Elephpant 2 GB' },
  { mb:  4096, price: 5_000, label: 'Deadly DDR4 4 GB' },
];
const VALID_RAM_MB = RAM_TIERS.map(t => t.mb);
const DEFAULT_RAM_MB = 4096;  // matches user's clan setup as of R70

function cpuUpgradeCost(cpuMhz) {
  return CPU_TIERS.find(t => t.mhz === cpuMhz)?.price ?? 0;
}
function ramUpgradeCost(ramMb) {
  return RAM_TIERS.find(t => t.mb === ramMb)?.price ?? 0;
}

function totalCpuGhz(subPcCount, cpuMhz) {
  return subPcCount * cpuMhz / 1000;
}

function totalRamMb(subPcCount, ramMb) {
  return ramMb * subPcCount;
}

// Sub-PC purchase ladder, from findings/HARDWARE-COST-ANALYSIS.md.
//   nth=1: starter, $0 (already owned, never in ROI tile)
//   nth=2..9: per the cumulative table
//   nth=10+: all $1,000,000
const SERVER_PRICE_LADDER = {
  2: 1_000,
  3: 10_000,
  4: 25_000,
  5: 50_000,
  6: 100_000,
  7: 150_000,
  8: 250_000,
  9: 500_000,
};
const SERVER_PRICE_FLOOR = 1_000_000;  // nth >= 10
// HDD is always SSD2 2 GB ($1k) — non-negotiable, since high-version viruses
// (CRC v15+ at 2,830 MB, vminer v15.0 at 2,830 MB) won't fit on the 100 MB
// starter HDD. CPU and RAM are configurable via the pickers.
const HDD_COST = 1_000;

function kitCost(cpuMhz, ramMb) {
  return cpuUpgradeCost(cpuMhz) + HDD_COST + ramUpgradeCost(ramMb);
}

function subPcCost(nth, cpuMhz, ramMb) {
  if (nth <= 1) return 0;
  const serverPrice = SERVER_PRICE_LADDER[nth] ?? SERVER_PRICE_FLOOR;
  return serverPrice + kitCost(cpuMhz, ramMb);
}

// ──────────────────────────────────────────────────────────────────────
// Research cost (from findings/RESEARCH-COSTS.md)
//   Source: legacy-master/classes/PC.class.php:5884 (research_calculatePrice)
//   Fork multipliers verified against R70 2026-05-08/09 data (24 points)
// ──────────────────────────────────────────────────────────────────────

// Per-virus multipliers used by legacy_cost
//   warez (vWarez): fork m=11 (verified)
//   spam  (vSpam):  fork m=11 (verified)
//   miner (vMiner): fork m=15 (verified R70 2026-05-21, 7 data points across
//                   i=31, i=91, i=160; both formula branches; N=1 single-tick
//                   and N=5/6/10 batched. Legacy didn't include vminer in
//                   research_getMultiplier — switch defaults to 15, which the
//                   fork preserved.)
const RESEARCH_M = { warez: 11, spam: 11, miner: 15 };

// legacy_cost(i, m): per-tick research cost. i = internal version = 10 × display.
function legacyCost(i, m) {
  if (i >= 100) {
    return Math.ceil(i * (m * ((i - 90) / 100) - 10) + 3000 - (25 - m) * 80);
  }
  return Math.ceil((i * i - 9 * i) / 100 * m);
}

// researchCost(fromV, toV, m): total cost from version fromV to toV.
//   N = ticks = 10 × (toV − fromV)
//   Single-tick (N=1): no surcharge, just legacy_cost
//   Batch (N≥2):       (1 + N/100) × Σ legacy_cost(i+k, m) for k in 0..N−1
function researchCost(fromV, toV, m) {
  const N = Math.round(10 * (toV - fromV));
  if (N <= 0) return 0;
  const i = Math.round(10 * fromV);
  let sum = 0;
  for (let k = 0; k < N; k++) sum += legacyCost(i + k, m);
  if (N === 1) return sum;
  return Math.ceil((1 + N / 100) * sum);
}

// ──────────────────────────────────────────────────────────────────────
// State model
// ──────────────────────────────────────────────────────────────────────

// Field order here must match the object literal parseLoadout returns —
// the selfTest round-trips via JSON.stringify, which is key-order sensitive.
const DEFAULT_LOADOUT = Object.freeze({
  subPcCount: 8,
  netMbit: 1000,
  activeVirus: 'spam',     // 'warez' | 'spam' | 'miner'
  spamVersion: 10.0,
  warezVersion: 10.0,
  minerVersion: 10.0,
  collectorVersion: 10.0,
  ramMbPerSub: DEFAULT_RAM_MB,
  cpuMhzPerSub: DEFAULT_CPU_MHZ,
});

// Top-level state
const state = {
  loadoutA: { ...DEFAULT_LOADOUT },
  btcPrice: null,            // populated by fetch
  btcStale: false,
  // Override knobs (null = use defaults / live BTC)
  btcOverride: null,
  kmOverride: null,
  roundDaysLeft: 30,
};

// ──────────────────────────────────────────────────────────────────────
// URL state serialization
//   ?a=8,1000,spam,10,10,10,10,4096,6000
//   fields per loadout: subs, netMbit, activeVirus, spamV, warezV, minerV,
//   collectorV, ramMb, cpuMhz
//   Trailing ramMb and cpuMhz are optional — older shared URLs (7 or 8 fields)
//   still parse, with missing tiers defaulting to DEFAULT_RAM_MB / DEFAULT_CPU_MHZ.
// ──────────────────────────────────────────────────────────────────────

const VIRUS_ENUM = ['warez', 'spam', 'miner'];
const VIRUS_VERSION_MAX = 99.0;     // warez/spam/miner sliders cap at 99
const COLLECTOR_VERSION_MAX = 99.0; // collector slider caps at 99

function serializeLoadout(l) {
  return [
    l.subPcCount, l.netMbit, l.activeVirus,
    l.spamVersion, l.warezVersion, l.minerVersion,
    l.collectorVersion, l.ramMbPerSub, l.cpuMhzPerSub,
  ].join(',');
}

function parseLoadout(str) {
  if (!str) return null;
  const p = str.split(',');
  if (p.length < 7 || p.length > 9) return null;
  const subs = parseInt(p[0], 10);
  const net = parseInt(p[1], 10);
  const virus = p[2];
  const sv = parseFloat(p[3]), wv = parseFloat(p[4]), mv = parseFloat(p[5]);
  const cv = parseFloat(p[6]);
  const ramMb  = p.length >= 8 ? parseInt(p[7], 10) : DEFAULT_RAM_MB;
  const cpuMhz = p.length >= 9 ? parseInt(p[8], 10) : DEFAULT_CPU_MHZ;
  // Validate
  if (!Number.isFinite(subs) || subs < 0 || subs > 99) return null;
  if (![1, 100, 250, 500, 1000].includes(net)) return null;
  if (!VIRUS_ENUM.includes(virus)) return null;
  for (const v of [sv, wv, mv]) {
    if (!Number.isFinite(v) || v < 1.0 || v > VIRUS_VERSION_MAX) return null;
  }
  if (!Number.isFinite(cv) || cv < 1.0 || cv > COLLECTOR_VERSION_MAX) return null;
  if (!VALID_RAM_MB.includes(ramMb)) return null;
  if (!VALID_CPU_MHZ.includes(cpuMhz)) return null;
  return {
    subPcCount: subs, netMbit: net, activeVirus: virus,
    spamVersion: sv, warezVersion: wv, minerVersion: mv,
    collectorVersion: cv, ramMbPerSub: ramMb, cpuMhzPerSub: cpuMhz,
  };
}

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const a = parseLoadout(params.get('a'));
  if (a) state.loadoutA = a;
  const rdl = parseInt(params.get('rdl') || '', 10);
  if (Number.isFinite(rdl) && rdl >= 0) state.roundDaysLeft = rdl;
}

let urlSyncTimer = null;
function urlSync() {
  clearTimeout(urlSyncTimer);
  urlSyncTimer = setTimeout(() => {
    const params = new URLSearchParams();
    params.set('a', serializeLoadout(state.loadoutA));
    if (state.roundDaysLeft !== 30) params.set('rdl', state.roundDaysLeft);
    const newUrl = window.location.pathname + '?' + params.toString();
    history.replaceState(null, '', newUrl);
  }, 300);
}

// ──────────────────────────────────────────────────────────────────────
// Sanity assertions (run at module load; log to console on regression)
// ──────────────────────────────────────────────────────────────────────
(function selfTest() {
  function near(actual, expected, tol = 0.01, label = '') {
    const ok = Math.abs(actual - expected) / expected < tol;
    console.assert(ok, `FAIL ${label}: expected ≈${expected}, got ${actual}`);
    return ok;
  }
  // virusPercent: v1.0 = 1.02, v10.0 = 1.20, v15.0 = 1.30, v25.0 = 1.50
  console.assert(virusPercent(1.0)  === 1.02, 'virusPercent(1.0)');
  console.assert(virusPercent(10.0) === 1.20, 'virusPercent(10.0)');
  console.assert(virusPercent(15.0) === 1.30, 'virusPercent(15.0)');
  // collectorBonus: v10.0 = 1.10×, v25.0 = 1.25×
  console.assert(collectorBonus(10.0) === 1.10, 'collectorBonus(10.0)');
  console.assert(collectorBonus(25.0) === 1.25, 'collectorBonus(25.0)');
  // Earning-rate hand-calcs at collector v1.0 (× 1.01 bonus on each base hand-calc):
  //   warez: 3.00 × 1000 × 1.28 = $3,840          → × 1.01 = $3,878.40
  //   spam:  0.0501 × 57,344 × 1.30 = $3,733.44   → × 1.01 = $3,770.77
  //   miner: 100 × 8 × 1.30 = $1,040              → × 1.01 = $1,050.40
  near(warezPerHr(1000, 14.0, 1.0), 3878.40, 0.001, 'warezPerHr 1Gbit v14 col1');
  near(spamPerHr(57344, 15.0, 1.0),  3770.77, 0.005, 'spamPerHr 57344 v15 col1');
  near(minerPerHr(8, 15.0, 1.0),     1050.40, 0.005, 'minerPerHr 8GHz v15 col1');
  // Hardware aggregation
  console.assert(totalCpuGhz(8, 6000) === 48, 'totalCpuGhz(8, i9) — matches clan-server-upgrades.md #17 / 12 subs @ 6 GHz');
  console.assert(totalCpuGhz(8, 500)  === 4,  'totalCpuGhz(8, starter)');
  console.assert(totalRamMb(14, 4096) === 57344, 'totalRamMb(14, 4 GB) — matches FINDINGS.md:42');
  console.assert(totalRamMb(12, 4096) === 49152, 'totalRamMb(12, 4 GB) — matches clan-server-upgrades.md:53');
  console.assert(totalRamMb(8, 256) === 2048,    'totalRamMb(8, starter 256 MB)');
  // NPC-stolen virus baselines (per round NPC spreadsheet — see findings/NPC-PREINSTALLED-VERSIONS.md)
  console.assert(NPC_BASE_VERSIONS.warez === 14.0, 'NPC base warez = Ultra Warez v14.0');
  console.assert(NPC_BASE_VERSIONS.spam  === 12.0, 'NPC base spam  = Ultra Spam v12.0');
  console.assert(NPC_BASE_VERSIONS.miner === 15.0, 'NPC base miner = Epic Miner v15.0');
  // CPU tiers
  console.assert(cpuUpgradeCost(500)  === 0,      'cpuUpgradeCost(500) — starter free');
  console.assert(cpuUpgradeCost(6000) === 15_000, 'cpuUpgradeCost(6000) — i9 13900k $15k');
  // RAM tiers
  console.assert(ramUpgradeCost(256)  === 0,     'ramUpgradeCost(256) — starter free');
  console.assert(ramUpgradeCost(4096) === 5_000, 'ramUpgradeCost(4096) — Deadly DDR4 $5k');
  // Kit cost
  console.assert(kitCost(500,  256)  === 1_000,  'kitCost(starter CPU + starter RAM) — HDD only');
  console.assert(kitCost(6000, 256)  === 16_000, 'kitCost(i9 + starter RAM) — matches old $16k baseline');
  console.assert(kitCost(6000, 4096) === 21_000, 'kitCost(i9 + 4GB DDR4)');
  // Sub-PC ladder (default 6 GHz / 4 GB)
  console.assert(subPcCost(1,  6000, 4096) === 0,          'subPcCost(1) — starter free');
  console.assert(subPcCost(2,  6000, 4096) === 22_000,     'subPcCost(2) — $1k server + $21k kit');
  console.assert(subPcCost(9,  6000, 4096) === 521_000,    'subPcCost(9, i9+4GB)');
  console.assert(subPcCost(10, 6000, 4096) === 1_021_000,  'subPcCost(10, i9+4GB)');
  console.assert(subPcCost(15, 6000, 4096) === 1_021_000,  'subPcCost(15, i9+4GB) — same as 10');
  // Sub-PC ladder at i9 + min RAM — matches HARDWARE-COST-ANALYSIS.md original numbers
  console.assert(subPcCost(2,  6000, 256) === 17_000,    'subPcCost(2, i9+256MB) — HARDWARE-COST-ANALYSIS.md baseline');
  console.assert(subPcCost(10, 6000, 256) === 1_016_000, 'subPcCost(10, i9+256MB) — HARDWARE-COST-ANALYSIS.md');
  // Research cost — empirically verified rows from RESEARCH-COSTS.md
  console.assert(researchCost(14.0, 14.1, 11) === 1250,   'warez 14.0→14.1');
  console.assert(researchCost(14.0, 15.0, 11) === 14331,  'warez 14.0→15.0 batch');
  console.assert(researchCost(10.1, 10.2, 11) === 993,    'spam 10.1→10.2');
  console.assert(researchCost(21.0, 21.1, 23) === 6536,   'crc 21.0→21.1 (m=23)');
  console.assert(researchCost(21.0, 22.0, 23) === 75235,  'crc 21.0→22.0 batch (m=23)');
  // Miner — R70 2026-05-21, 7 verified samples (m=15, both formula branches)
  console.assert(researchCost(3.1, 3.2, 15)   === 103,    'miner 3.1→3.2 (sub-i=100)');
  console.assert(researchCost(3.1, 3.6, 15)   === 628,    'miner 3.1→3.6 batch');
  console.assert(researchCost(3.1, 4.1, 15)   === 1571,   'miner 3.1→4.1 batch boundary');
  console.assert(researchCost(9.1, 9.2, 15)   === 1120,   'miner 9.1→9.2 (sub-i=100)');
  console.assert(researchCost(9.1, 9.6, 15)   === 6157,   'miner 9.1→9.6 batch');
  console.assert(researchCost(16.0, 16.1, 15) === 2280,   'miner 16.0→16.1 (i≥100)');
  console.assert(researchCost(16.0, 17.0, 15) === 26344,  'miner 16.0→17.0 batch');
  // BTC null safety — miner BTC/hr must render '—' when no live price and no
  // override is set, rather than computing against a silent fallback. Division
  // by null coerces to Infinity, which fmtBtc treats as '—'.
  console.assert(!Number.isFinite(minerBtcPerHr(8, 10.0, 10.0, null, 100)),
    'minerBtcPerHr(btc=null) → non-finite (rendered as — by fmtBtc)');
  // Cumulative cluster cost (sub-PCs #2..#N), used by the cluster-total ROI line.
  // At i9 CPU + min RAM, the ladder matches HARDWARE-COST-ANALYSIS.md:36-44 exactly:
  //   #2=17k, #3=26k, #4=41k, #5=66k, #6=116k, #7=166k, #8=266k  → sum @ N=8 = $698k
  //   adding #9=516k → @ N=9 = $1.214M; #10=1.016M → @ N=10 = $2.230M
  let cumN8 = 0;  for (let n = 2; n <= 8;  n++) cumN8  += subPcCost(n, 6000, 256);
  let cumN10 = 0; for (let n = 2; n <= 10; n++) cumN10 += subPcCost(n, 6000, 256);
  console.assert(cumN8  === 698_000,   'cluster cumulative @ N=8, i9+256MB');
  console.assert(cumN10 === 2_230_000, 'cluster cumulative @ N=10, i9+256MB');
  // URL serialization round-trip
  const sample = { ...DEFAULT_LOADOUT };
  const roundTripped = parseLoadout(serializeLoadout(sample));
  console.assert(JSON.stringify(roundTripped) === JSON.stringify(sample),
    'loadout serialize→parse round-trip');
  // Malformed URL falls back to null
  console.assert(parseLoadout('garbage') === null, 'parseLoadout garbage');
  console.assert(parseLoadout('8,1000,spam,10,10,10') === null, 'parseLoadout short');
  console.assert(parseLoadout('8,999,spam,10,10,10,10') === null, 'parseLoadout bad NET');
  console.assert(parseLoadout('8,1000,doom,10,10,10,10') === null, 'parseLoadout bad virus');
  console.assert(parseLoadout('8,1000,spam,100,10,10,10') === null, 'parseLoadout warez >99');
  console.assert(parseLoadout('8,1000,spam,10,100,10,10') === null, 'parseLoadout spam >99');
  console.assert(parseLoadout('8,1000,spam,10,10,100,10') === null, 'parseLoadout miner >99');
  console.assert(parseLoadout('8,1000,spam,10,10,10,100') === null, 'parseLoadout collector >99');
  console.assert(parseLoadout('8,1000,spam,10,10,10,99') !== null, 'parseLoadout collector 99 OK');
  console.assert(parseLoadout('8,1000,spam,10,10,10,10,4096') !== null, 'parseLoadout with RAM tier');
  console.assert(parseLoadout('8,1000,spam,10,10,10,10,777')  === null, 'parseLoadout bad RAM tier');
  console.assert(parseLoadout('8,1000,spam,10,10,10,10,4096,6000') !== null, 'parseLoadout with CPU tier');
  console.assert(parseLoadout('8,1000,spam,10,10,10,10,4096,7000') === null, 'parseLoadout bad CPU tier');
  // Pre-picker URLs still parse (backward compat)
  const legacy7 = parseLoadout('8,1000,spam,10,10,10,10');
  console.assert(legacy7 && legacy7.ramMbPerSub === DEFAULT_RAM_MB && legacy7.cpuMhzPerSub === DEFAULT_CPU_MHZ,
    'parseLoadout legacy 7-field URL defaults RAM and CPU');
  const legacy8 = parseLoadout('8,1000,spam,10,10,10,10,256');
  console.assert(legacy8 && legacy8.ramMbPerSub === 256 && legacy8.cpuMhzPerSub === DEFAULT_CPU_MHZ,
    'parseLoadout legacy 8-field URL defaults CPU');
})();

// ──────────────────────────────────────────────────────────────────────
// Recompute: pure function, state in → derived out
// ──────────────────────────────────────────────────────────────────────

// Returns null when there's no live price and no override — callers must
// handle that case (miner BTC/hr renders as '—', no silent $75k stand-in).
// BTC is only used for the BTC/hr display on the miner card; all $/hr math,
// ROI, payback, and optimal-virus ranking are BTC-independent (per the
// dev-confirmed dynamic-scaling model: $-yield is constant, BTC paid varies).
function getEffectiveBtc() {
  return state.btcOverride ?? state.btcPrice ?? null;
}
function getEffectiveKm() {
  return state.kmOverride ?? K_M;
}

// ──────────────────────────────────────────────────────────────────────
// BTC price fetch
//   Primary: blockchain.info/q/24hrprice — same 24hr-average source the game
//     uses for dynamic miner-BTC scaling. CORS-permitted (verified 2026-05-21).
//   Fallback: coingecko spot — used only if the primary returns non-OK,
//     non-finite, or implausible (< $1k). Lags blockchain.info by seconds at
//     most for our purposes; spread vs the 24hr-avg has been ≤ $50 in spot
//     checks. The fallback exists for resilience, not for accuracy parity.
//   If both fail: state.btcStale = true, header shows '$—' + a 'stale' chip,
//     and the miner BTC/hr cell renders '—' (no silent fallback price).
// ──────────────────────────────────────────────────────────────────────

const BTC_REFRESH_MS = 5 * 60 * 1000;

async function fetchBtc() {
  // Primary
  try {
    const r = await fetch('https://blockchain.info/q/24hrprice');
    if (r.ok) {
      const text = await r.text();
      const n = parseFloat(text);
      if (Number.isFinite(n) && n > 1000) {
        return { price: n, source: 'blockchain.info' };
      }
    }
  } catch (e) { /* CORS / network — fall through */ }

  // Fallback 1: coingecko
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    if (r.ok) {
      const json = await r.json();
      const n = json?.bitcoin?.usd;
      if (Number.isFinite(n) && n > 1000) {
        return { price: n, source: 'coingecko' };
      }
    }
  } catch (e) { /* fall through */ }

  return { price: null, source: null };
}

async function refreshBtc() {
  const { price } = await fetchBtc();
  if (price !== null) {
    state.btcPrice = price;
    state.btcStale = false;
  } else if (state.btcPrice === null) {
    state.btcStale = true;
  } else {
    state.btcStale = true;
  }
  render();
}

function recompute(loadout) {
  const cpu = totalCpuGhz(loadout.subPcCount, loadout.cpuMhzPerSub);
  const ram = totalRamMb(loadout.subPcCount, loadout.ramMbPerSub);
  const km = getEffectiveKm();
  const btc = getEffectiveBtc();

  const warez = warezPerHr(loadout.netMbit, loadout.warezVersion, loadout.collectorVersion);
  const spam  = spamPerHr(ram,             loadout.spamVersion,  loadout.collectorVersion);
  const miner = minerPerHr(cpu,            loadout.minerVersion, loadout.collectorVersion, km);
  const minerBtc = minerBtcPerHr(cpu, loadout.minerVersion, loadout.collectorVersion, btc, km);

  // Optimal = argmax($/hr)
  const ranked = [
    { virus: 'warez', perHr: warez },
    { virus: 'spam',  perHr: spam  },
    { virus: 'miner', perHr: miner },
  ].sort((a, b) => b.perHr - a.perHr);
  const optimal = ranked[0].virus;

  // ROI: next sub-PC
  const nextNth = loadout.subPcCount + 1;
  const nextCost = subPcCost(nextNth, loadout.cpuMhzPerSub, loadout.ramMbPerSub);
  let deltaPerHr;
  if (loadout.activeVirus === 'warez') {
    deltaPerHr = 0;  // warez doesn't scale with sub-PC count (NET is cluster-wide)
  } else if (loadout.activeVirus === 'spam') {
    deltaPerHr = SPAM_RATE * loadout.ramMbPerSub
                  * virusPercent(loadout.spamVersion)
                  * collectorBonus(loadout.collectorVersion);
  } else {
    deltaPerHr = km * (loadout.cpuMhzPerSub / 1000)
                  * virusPercent(loadout.minerVersion)
                  * collectorBonus(loadout.collectorVersion);
  }
  const subPcPaybackHr = deltaPerHr > 0 ? nextCost / deltaPerHr : Infinity;
  const subPcPaybackDays = subPcPaybackHr / 24;

  // ROI: next research bump (single tick on active virus)
  const activeVKey = loadout.activeVirus + 'Version';
  const fromV = loadout[activeVKey];
  // Next bump = next whole version (slider step is 1.0)
  const toV = Math.min(99.0, Math.floor(fromV) + 1);
  const m = RESEARCH_M[loadout.activeVirus];
  const researchPrice = fromV >= 99.0 ? 0 : researchCost(fromV, toV, m);
  function rateAt(v) {
    if (loadout.activeVirus === 'warez') return warezPerHr(loadout.netMbit, v, loadout.collectorVersion);
    if (loadout.activeVirus === 'spam')  return spamPerHr(ram, v, loadout.collectorVersion);
    return minerPerHr(cpu, v, loadout.collectorVersion, km);
  }
  const researchDelta = fromV >= 99.0 ? 0 : (rateAt(toV) - rateAt(fromV));
  const researchPaybackHr = researchDelta > 0 ? researchPrice / researchDelta : Infinity;

  // Total cluster investment + break-even (cumulative, sub-PCs #2..#N).
  // Δrate denominator = per-sub-PC gain × (N−1), consistent with the per-step
  // payback math above (Δcost / Δgain). Warez has deltaPerHr=0 so payback=∞.
  let clusterCost = 0;
  for (let n = 2; n <= loadout.subPcCount; n++) {
    clusterCost += subPcCost(n, loadout.cpuMhzPerSub, loadout.ramMbPerSub);
  }
  const clusterDeltaPerHr = deltaPerHr * Math.max(0, loadout.subPcCount - 1);
  const clusterPaybackHr = clusterDeltaPerHr > 0
    ? clusterCost / clusterDeltaPerHr
    : (clusterCost === 0 ? 0 : Infinity);

  // Total research investment + break-even, from per-virus NPC-stolen baseline.
  // Below baseline → $0 (got it free from an NPC). At baseline → $0. Above → batched cost.
  const npcBase = NPC_BASE_VERSIONS[loadout.activeVirus];
  const totalResearchCost = fromV > npcBase
    ? researchCost(npcBase, fromV, m)
    : 0;
  const totalResearchDelta = fromV > npcBase
    ? (rateAt(fromV) - rateAt(npcBase))
    : 0;
  const totalResearchPaybackHr = totalResearchDelta > 0
    ? totalResearchCost / totalResearchDelta
    : (totalResearchCost === 0 ? 0 : Infinity);

  // Research progression rows.
  // Anchor on effectiveBase = max(currentV, npcBase): everything below npcBase
  // is free from NPCs, so the table starts above it. One row per whole version
  // step from there to v99 — matches the slider's whole-version granularity.
  const effectiveBase = Math.max(fromV, npcBase);
  const rows = [];
  for (let t = Math.floor(effectiveBase) + 1; t <= 99; t++) {
    const single = researchCost(effectiveBase, t, m);
    const N = Math.round(10 * (t - effectiveBase));
    let singleCumul = 0;
    const iStart = Math.round(10 * effectiveBase);
    for (let k = 0; k < N; k++) singleCumul += legacyCost(iStart + k, m);
    const deltaRate = rateAt(t) - rateAt(effectiveBase);
    rows.push({
      target: t,
      deltaRate,
      singleCost: singleCumul,
      batchedCost: single,
      singlePaybackHr: deltaRate > 0 ? singleCumul / deltaRate : Infinity,
      batchPaybackHr:  deltaRate > 0 ? single      / deltaRate : Infinity,
    });
  }

  return {
    cpu, ram,
    warez, spam, miner, minerBtc,
    optimal,
    nextNth, nextCost, deltaPerHr, subPcPaybackHr, subPcPaybackDays,
    researchFromV: fromV, researchToV: toV,
    researchPrice, researchDelta, researchPaybackHr,
    clusterCost, clusterDeltaPerHr, clusterPaybackHr,
    npcBase, totalResearchCost, totalResearchDelta, totalResearchPaybackHr,
    researchEffectiveBase: effectiveBase,
    rows,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Render
// ──────────────────────────────────────────────────────────────────────

function fmt$(n) {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 10_000)    return '$' + (n / 1_000).toFixed(1) + 'k';
  return '$' + Math.round(n).toLocaleString();
}
function fmt$Hr(n) { return fmt$(n) + '/hr'; }
function fmt$Day(n) { return fmt$(n * 24) + '/day'; }
function fmtBtc(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(6) + ' BTC/hr';
}
function fmtDays(hours) {
  if (!Number.isFinite(hours)) return '∞';
  const days = hours / 24;
  if (days < 1) {
    const h = Math.round(hours);
    if (h === 0) {
      const m = Math.round(hours * 60);
      return m + 'm';
    }
    return h + 'h';
  }
  return days.toFixed(1) + 'd';
}

function fmtRam(mb) {
  if (mb >= 1024) {
    const gb = mb / 1024;
    return (gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)) + ' GB';
  }
  return mb + ' MB';
}

function renderLoadout(slot, loadout, derived) {
  const root = document.querySelector(`[data-loadout="${slot}"].loadout`);
  if (!root) return;

  // Server-totals row (CPU GHz / RAM MB-or-GB / NET Mbit)
  const totalsCpu = root.querySelector('.js-total-cpu');
  const totalsRam = root.querySelector('.js-total-ram');
  const totalsNet = root.querySelector('.js-total-net');
  if (totalsCpu) totalsCpu.textContent = derived.cpu.toFixed(1) + ' GHz';
  if (totalsRam) totalsRam.textContent = fmtRam(derived.ram);
  if (totalsNet) {
    totalsNet.textContent = loadout.netMbit >= 1000
      ? (loadout.netMbit / 1000) + ' Gbit'
      : loadout.netMbit + ' Mbit';
  }

  const cards = document.querySelectorAll(`.virus-cards[data-loadout="${slot}"] .virus-card`);
  cards.forEach(card => {
    const virus = card.dataset.virus;
    const rate = derived[virus];
    const versionKey = virus + 'Version';
    card.querySelector('.vc-version').textContent = 'v' + loadout[versionKey].toFixed(1);
    card.querySelector('.vc-dollar').textContent = fmt$Hr(rate);
    card.querySelector('.vc-daily').textContent = fmt$Day(rate);
    if (virus === 'miner') {
      card.querySelector('.vc-btc').textContent = fmtBtc(derived.minerBtc);
    }
    card.classList.toggle('vc-optimal', virus === derived.optimal);
    card.classList.toggle('vc-selected', virus === loadout.activeVirus);
  });

  const roi = document.querySelector(`.roi-row[data-loadout="${slot}"]`);
  if (roi) {
    roi.querySelector('.js-roi-subpc-nth').textContent = '#' + derived.nextNth;
    roi.querySelector('.js-roi-subpc-delta').textContent = fmt$(derived.deltaPerHr);
    roi.querySelector('.js-roi-subpc-cost').textContent = fmt$(derived.nextCost);
    roi.querySelector('.js-roi-subpc-days').textContent = fmtDays(derived.subPcPaybackHr);
    roi.querySelector('.js-roi-research-from').textContent = 'v' + derived.researchFromV.toFixed(1);
    roi.querySelector('.js-roi-research-to').textContent = 'v' + derived.researchToV.toFixed(1);
    roi.querySelector('.js-roi-research-delta').textContent = fmt$(derived.researchDelta);
    roi.querySelector('.js-roi-research-cost').textContent = fmt$(derived.researchPrice);
    roi.querySelector('.js-roi-research-time').textContent = fmtDays(derived.researchPaybackHr);
    roi.querySelectorAll('.js-roi-active-virus').forEach(el => {
      el.textContent = loadout.activeVirus;
    });

    // Cluster total — cumulative sub-PC cost ÷ cumulative Δ$/hr
    const clusterRangeEl = roi.querySelector('.js-roi-cluster-range');
    const clusterSummaryEl = roi.querySelector('.js-roi-cluster-summary');
    if (clusterRangeEl && clusterSummaryEl) {
      clusterRangeEl.textContent = '#1→#' + loadout.subPcCount;
      if (loadout.subPcCount <= 1) {
        clusterSummaryEl.textContent = 'starter only ($0)';
      } else if (derived.clusterDeltaPerHr <= 0) {
        clusterSummaryEl.textContent =
          fmt$(derived.clusterCost) + ' sunk · ∞ (warez doesn’t scale with sub-PCs)';
      } else {
        clusterSummaryEl.textContent =
          fmt$(derived.clusterCost) + ' sunk · break-even ' + fmtDays(derived.clusterPaybackHr);
      }
    }

    // Research total — cumulative research from per-virus NPC baseline ÷ cumulative Δ$/hr
    const totalvRangeEl = roi.querySelector('.js-roi-totalv-range');
    const totalvSummaryEl = roi.querySelector('.js-roi-totalv-summary');
    if (totalvRangeEl && totalvSummaryEl) {
      totalvRangeEl.textContent =
        'v' + derived.npcBase.toFixed(1) + ' → v' + derived.researchFromV.toFixed(1);
      if (derived.researchFromV <= derived.npcBase) {
        totalvSummaryEl.textContent = 'free (v' + derived.researchFromV.toFixed(1) +
          ' ≤ v' + derived.npcBase.toFixed(1) + ' NPC default)';
      } else {
        totalvSummaryEl.textContent =
          fmt$(derived.totalResearchCost) + ' sunk · break-even ' +
          fmtDays(derived.totalResearchPaybackHr);
      }
    }
  }

  const tbody = document.querySelector(`.research-table[data-loadout="${slot}"] .js-research-tbody`);
  if (tbody) {
    tbody.innerHTML = derived.rows.map(r => {
      const overRound = (r.singlePaybackHr / 24) > state.roundDaysLeft;
      const isNext = r.target === Math.floor(derived.researchEffectiveBase) + 1;
      const cls = [overRound ? 'over-round' : '', isNext ? 'research-next' : ''].filter(Boolean).join(' ');
      return `<tr class="${cls}">
        <td>v${r.target.toFixed(1)}${isNext ? ' <span class="ladder-tag ladder-tag-next">next</span>' : ''}</td>
        <td>+${fmt$(r.deltaRate)}/hr</td>
        <td>${fmt$(r.singleCost)}</td>
        <td>${fmt$(r.batchedCost)}</td>
        <td>${fmtDays(r.singlePaybackHr)}</td>
        <td>${fmtDays(r.batchPaybackHr)}</td>
      </tr>`;
    }).join('');
  }

  // Research-table note: "From vN upward (...)"
  const effbase = derived.researchEffectiveBase;
  const effbaseEl = document.querySelector('.js-research-effbase');
  const reasonEl = document.querySelector('.js-research-effbase-reason');
  if (effbaseEl) effbaseEl.textContent = 'v' + effbase.toFixed(1);
  if (reasonEl) {
    if (effbase >= 99.0) {
      reasonEl.textContent = 'capped at v99 — no targets remain';
    } else if (loadout[loadout.activeVirus + 'Version'] < derived.npcBase) {
      reasonEl.textContent =
        'NPC max v' + derived.npcBase.toFixed(1) +
        ' — steal free, then research above';
    } else {
      reasonEl.textContent = 'your current version';
    }
  }

  root.querySelectorAll('.virus-btn').forEach(b => {
    b.classList.toggle('virus-btn-active', b.dataset.virus === loadout.activeVirus);
  });

  renderSubPcLadder(slot, loadout, derived);
}

// Sub-PC purchase ladder: walks nth=2..99, shows server/kit/marginal/cumulative
// and the marginal-payback at current Δ$/hr. Mirrors recompute()'s deltaPerHr
// so the per-sub-PC gain stays in sync with the ROI tile.
const LADDER_MAX_NTH = 99;

function renderSubPcLadder(slot, loadout, derived) {
  const block = document.querySelector(`.subpc-ladder-block`);
  if (!block) return;

  // Annotation line above the table
  const perPcEl = block.querySelector('.js-ladder-per-pc');
  const virusEl = block.querySelector('.js-ladder-virus');
  const cpuTierEl = block.querySelector('.js-ladder-cpu-tier');
  const ramTierEl = block.querySelector('.js-ladder-ram-tier');
  const kitCostEl = block.querySelector('.js-ladder-kit-cost');
  if (perPcEl) {
    perPcEl.textContent = derived.deltaPerHr > 0
      ? fmt$Hr(derived.deltaPerHr)
      : '$0/hr (warez doesn’t scale with sub-PC count)';
  }
  if (virusEl) virusEl.textContent = loadout.activeVirus;
  // tier.label already says "(starter)" for the free rows, so we only append a
  // price suffix for the paid tiers — avoids "(starter) (free starter)".
  if (cpuTierEl) {
    const t = CPU_TIERS.find(x => x.mhz === loadout.cpuMhzPerSub);
    const suffix = t && t.price > 0 ? ' / ' + fmt$(t.price) : '';
    cpuTierEl.textContent = (t?.label ?? `${loadout.cpuMhzPerSub} MHz`) + suffix;
  }
  if (ramTierEl) {
    const t = RAM_TIERS.find(x => x.mb === loadout.ramMbPerSub);
    const suffix = t && t.price > 0 ? ' / ' + fmt$(t.price) : '';
    ramTierEl.textContent = (t?.label ?? `${loadout.ramMbPerSub} MB`) + suffix;
  }
  if (kitCostEl) kitCostEl.textContent = fmt$(kitCost(loadout.cpuMhzPerSub, loadout.ramMbPerSub));

  const tbody = block.querySelector('.js-ladder-tbody');
  if (!tbody) return;

  const kit = kitCost(loadout.cpuMhzPerSub, loadout.ramMbPerSub);
  let cumulative = 0;
  const rows = [];
  for (let nth = 2; nth <= LADDER_MAX_NTH; nth++) {
    const serverPrice = SERVER_PRICE_LADDER[nth] ?? SERVER_PRICE_FLOOR;
    const marginal = subPcCost(nth, loadout.cpuMhzPerSub, loadout.ramMbPerSub);
    cumulative += marginal;
    const paybackHr = derived.deltaPerHr > 0 ? marginal / derived.deltaPerHr : Infinity;
    const isCurrent = nth === loadout.subPcCount;
    const isNext = nth === loadout.subPcCount + 1;
    const overRound = (paybackHr / 24) > state.roundDaysLeft;
    const cls = [
      isCurrent ? 'ladder-current' : '',
      isNext ? 'ladder-next' : '',
      overRound ? 'over-round' : '',
    ].filter(Boolean).join(' ');
    rows.push(`<tr class="${cls}">
      <td>#${nth}${isCurrent ? ' <span class="ladder-tag">current</span>' : isNext ? ' <span class="ladder-tag ladder-tag-next">next</span>' : ''}</td>
      <td>${fmt$(serverPrice)}</td>
      <td>${fmt$(kit)}</td>
      <td>${fmt$(marginal)}</td>
      <td>${fmt$(cumulative)}</td>
      <td>${fmtDays(paybackHr)}</td>
    </tr>`);
  }
  tbody.innerHTML = rows.join('');
}

function render() {
  function syncSliders(slot, loadout) {
    const root = document.querySelector(`[data-loadout="${slot}"].loadout`);
    if (!root) return;
    root.querySelector('.js-sub-pc-count').value = loadout.subPcCount;
    root.querySelector('.js-sub-pc-count-value').textContent = loadout.subPcCount;
    root.querySelector('.js-net-mbit').value = loadout.netMbit;
    root.querySelector('.js-ram-mb').value = loadout.ramMbPerSub;
    root.querySelector('.js-cpu-mhz').value = loadout.cpuMhzPerSub;
    root.querySelector('.js-collector-version').value = loadout.collectorVersion;
    root.querySelector('.js-collector-version-value').textContent = loadout.collectorVersion.toFixed(1);
    for (const v of ['warez', 'spam', 'miner']) {
      root.querySelector(`.js-${v}-version`).value = loadout[v + 'Version'];
      root.querySelector(`.js-${v}-version-value`).textContent = loadout[v + 'Version'].toFixed(1);
    }
  }

  syncSliders('A', state.loadoutA);
  const derivedA = recompute(state.loadoutA);
  renderLoadout('A', state.loadoutA, derivedA);

  // BTC header
  document.getElementById('btc-price').textContent =
    state.btcPrice ? '$' + Math.round(state.btcPrice).toLocaleString() : '$—';
  document.getElementById('btc-stale').hidden = !state.btcStale;
}

// ──────────────────────────────────────────────────────────────────────
// Event handlers + entry point
// ──────────────────────────────────────────────────────────────────────

function attachEventHandlers() {
  function bind(selector, mutator) {
    document.querySelectorAll(selector).forEach(el => {
      el.addEventListener('input', () => {
        mutator(state.loadoutA, el.value);
        render();
        urlSync();
      });
    });
  }

  bind('.js-sub-pc-count', (l, v) => l.subPcCount = parseInt(v, 10));
  bind('.js-net-mbit', (l, v) => l.netMbit = parseInt(v, 10));
  bind('.js-ram-mb', (l, v) => l.ramMbPerSub = parseInt(v, 10));
  bind('.js-cpu-mhz', (l, v) => l.cpuMhzPerSub = parseInt(v, 10));
  bind('.js-collector-version', (l, v) => l.collectorVersion = parseFloat(v));
  bind('.js-warez-version', (l, v) => l.warezVersion = parseFloat(v));
  bind('.js-spam-version',  (l, v) => l.spamVersion  = parseFloat(v));
  bind('.js-miner-version', (l, v) => l.minerVersion = parseFloat(v));

  document.querySelectorAll('.virus-buttons').forEach(group => {
    group.addEventListener('click', e => {
      const btn = e.target.closest('.virus-btn');
      if (!btn) return;
      state.loadoutA.activeVirus = btn.dataset.virus;
      render();
      urlSync();
    });
  });

  document.getElementById('btc-override').addEventListener('input', e => {
    // Accept pasted/typed values with $ and thousands separators
    // (e.g. the "$109,432" shown in the live BTC chip above).
    const cleaned = e.target.value.replace(/[^0-9.]/g, '');
    const v = parseFloat(cleaned);
    state.btcOverride = Number.isFinite(v) && v > 0 ? v : null;
    render();
  });
  document.getElementById('km-override').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    state.kmOverride = Number.isFinite(v) && v > 0 ? v : null;
    render();
  });
  document.getElementById('round-days-left').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    state.roundDaysLeft = Number.isFinite(v) && v >= 0 ? v : 30;
    render();
    urlSync();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadStateFromUrl();
  attachEventHandlers();
  render();
  refreshBtc();                                         // initial fetch
  setInterval(refreshBtc, BTC_REFRESH_MS);              // 5-min refresh
});
