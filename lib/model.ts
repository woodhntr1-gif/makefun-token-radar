// Token Launch Radar — model "radar-2".
//
// One sealed DefiLlama snapshot in, one ranked board out. The board covers the
// snapshot's whole watchlist (TVL >= floor, no token recorded, no wrapped /
// staked / bridged product) and then keeps going: every other rankable
// pre-token protocol in the snapshot joins as an "early" row, because finding
// launches early is the radar's job. On this snapshot that is 226 rows.
//
// Implied value — what a token this protocol might one day issue could be
// worth — is derived only from the snapshot's own numbers:
//
//   implied = TVL x category_multiple x momentum x breadth x maturity
//
//   category_multiple  what listed peers in the same DefiLlama category are
//                      typically worth per dollar of TVL (DEX and perps fees
//                      monetise TVL best; bridges monetise it worst).
//   momentum           1 + clamp(change_7d, -50, 100)/100 x 0.45 — a protocol
//                      growing into a launch is worth more than a shrinking
//                      one, but one hot week never dominates.
//   breadth            1 + 0.35 x ln(1 + chain_count) / ln(21) — more chains
//                      means a wider holder base at distribution.
//   maturity           0.75 + 0.35 x min(age_days, 1095)/1095 — a protocol
//                      that has survived three years can sustain a token;
//                      a three-week one gets a discount, not a zero.
//
// No name is special-cased: one function scores every row, and every row
// carries its four multipliers so a reader can re-derive its value by hand.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-2';

/** FDV-per-TVL multiple by category keyword; the first matching rule wins. */
const CATEGORY_MULTIPLES: Array<[RegExp, number]> = [
  [/launchpad|prediction/, 1.15],
  [/derivative|perpetual|options|synthetic/, 1.0],
  [/dex|swap/, 0.85],
  [/lend|cdp|collateral|credit/, 0.55],
  [/nft|marketplace|payments|card/, 0.6],
  [/rwa|insurance|index/, 0.5],
  [/yield|farm|allocator|curator|liquidity manager/, 0.42],
  [/staking|restak/, 0.38],
  [/bridge/, 0.3],
  [/stable|algo/, 0.35],
  [/chain/, 0.9],
];

/** The multiple a category earns; unlisted categories sit mid-table at 0.5. */
export function categoryMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  for (const [pattern, multiple] of CATEGORY_MULTIPLES) if (pattern.test(c)) return multiple;
  return 0.5;
}

const DAY_MS = 86_400_000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export interface Scored {
  implied: number;
  category_multiple: number;
  momentum_multiplier: number;
  breadth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
}

/** One protocol's implied value and the four multipliers behind it. */
export function impliedValue(p: SnapshotProtocol, asOf: string): Scored {
  const age = ageDays(asOf, p.listed_at);
  const growth = Math.min(100, Math.max(-50, p.change_7d ?? 0));
  const momentum = 1 + (growth / 100) * 0.45;
  const breadth = 1 + (0.35 * Math.log(1 + p.chains.length)) / Math.log(21);
  const ageForModel = age ?? 300;
  const maturity = 0.75 + 0.35 * (Math.min(Math.max(ageForModel, 0), 1095) / 1095);
  const mult = categoryMultiple(p.category);
  const implied = Math.max(1, Math.round(p.tvl_usd * mult * momentum * breadth * maturity));
  return { implied, category_multiple: mult, momentum_multiplier: momentum, breadth_multiplier: breadth, maturity_multiplier: maturity, age_days: age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are products of another protocol's token, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Rankable = pre-token and not a wrapped, staked or bridged product of a
 * token that already trades — the watchlist's own exclusions, applied to the
 * early rows too: WBTC and Binance staked ETH are not future launches.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !PRODUCT_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    momentum_multiplier: number;
    breadth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The one core farming action for a category, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (/lend|cdp|collateral|credit/.test(c)) return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow no more than 40% against it once, so the account shows both sides of the market`;
  if (/dex|swap|liquidity manager/.test(c)) return `Add $${capital} of two-sided liquidity to ${n}'s highest-volume pool on ${chain} and leave the LP position open`;
  if (/bridge/.test(c)) return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, then make one swap with the bridged funds on the far side`;
  if (/staking|restak/.test(c)) return `Stake $${capital} of the native staking asset through ${n} on ${chain} and keep the staking receipt in the same wallet`;
  if (/derivative|perpetual|options|synthetic/.test(c)) return `Deposit $${capital} of USDC margin on ${n} and trade one small hedged position a week, keeping total fees under $10`;
  if (/prediction/.test(c)) return `Fund $${capital} on ${n} and hold positions in at least three different markets rather than one large bet`;
  if (/launchpad/.test(c)) return `Complete $${capital} of participation volume on ${n} across two separate launches on ${chain}, not a single one`;
  if (/rwa/.test(c)) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} after its KYC step, and hold the asset in the minting wallet`;
  if (/insurance/.test(c)) return `Buy $${capital} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy to expiry`;
  if (/stable|algo/.test(c)) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it rather than looping it`;
  if (/nft|marketplace/.test(c)) return `Make $${capital} of genuine purchases or sales on ${n} spread over at least four separate days`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its main vault or market and keep the position open`;
}

/**
 * A farm plan of seven steps, each with an action, a cost and a duration,
 * derived from the protocol's own record — category, chains, TVL and age.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 250 ? 8 : capital >= 150 ? 5 : 3;
  const steps = [
    `Set up one fresh wallet for ${p.name} only, fund it with $${capital + 25} of assets plus gas money, and store its seed phrase offline. Cost: about $${gas} of gas to fund. Time: 10 minutes.`,
    `${actionFor(p, capital, chain)}. Cost: $${capital} of capital plus about $${gas} of gas. Time: 20 minutes to set up.`,
    `Check the protocol's own app and docs for a points, seasons or rewards page before adding more capital; farm the metric it actually counts. Cost: nothing to check. Time: 10 minutes.`,
    `Repeat one qualifying action every week — a deposit, a swap, a borrow or a vote — so the wallet reads as a real user, not a one-day sybil. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so it appears in several weekly snapshots; younger protocols reward longer qualifying windows. Cost: the $${capital} stays deployed. Time: ${hold} days.`,
  ];
  if (p.chains.length > 1) {
    steps.push(`Repeat the core action on a second chain (${p.chains[1]}) with $50, because multi-chain users are commonly weighted higher at distribution. Cost: $50 plus about $4 of bridge and gas fees. Time: 25 minutes.`);
  }
  steps.push(
    `Keep a farm log with the wallet address, every date, amount and transaction hash, and review it monthly to cut positions that stopped counting. Cost: nothing but the log. Time: 5 minutes a month.`,
    `When a token or claim is announced, claim only through the link on the protocol's official app or account — never a link from a DM or a search ad. Cost: claim gas only, never pay anyone to claim. Time: 15 minutes.`,
  );
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  total_implied_usd: number;
  rows: BoardRow[];
}

/** The full board: whole watchlist first-class, plus every rankable early protocol. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(p.slug),
    age_days: s.age_days,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.category_multiple,
      momentum_multiplier: round4(s.momentum_multiplier),
      breadth_multiplier: round4(s.breadth_multiplier),
      maturity_multiplier: round4(s.maturity_multiplier),
      age_days: s.age_days,
    },
    farm_steps: farmSteps(p, s.age_days),
  }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    rows: board,
  };
  return { board, radar };
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Gate-shape check: coverage, ranks, order, farm steps, value sanity. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'board has a duplicate slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `board names unknown slug ${r.slug}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
