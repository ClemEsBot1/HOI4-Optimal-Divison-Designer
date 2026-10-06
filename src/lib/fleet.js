/**
 * Fleets: the task forces players build, scaled by the game's screening and production rules.
 *
 *   FLEETS                                     fleet types, each with its ship roles (naval.js SHIP_ROLES)
 *   composeFleet(fleet, { scale, buffer })     integer ship counts per role, split into task forces
 *   fleetSummary(fleet, comp, designs)         totals, speed, screening and the checks the rules ask for
 *   planDockyards(items, dockyards, output)    production lines that finish every ship type together
 *   buildBalance(plan, cls)                    the fewest screens per big ship afloat while the fleet is built
 *   fitScale(fleet, designs, opts)             the largest fleet a number of dockyards finishes by a deadline
 *
 * Rules (sources in SOURCES):
 *   - full screening needs 3 screens (destroyers, light cruisers) per capital ship and per carrier;
 *   - full carrier screening needs 1 capital ship (battleship, battlecruiser, heavy cruiser) per carrier;
 *   - past 4 carriers in a battle each extra carrier loses 20% of its planes, so a task force takes 4 at most;
 *   - a task force sails at the speed of its slowest ship;
 *   - a naval dockyard produces 2.5 IC a day and has no production efficiency; a production line takes at most
 *     5 dockyards for a capital ship or carrier and 10 for a screen or submarine, and builds one ship at a time.
 * The ratios on top of these (two heavy ships per carrier, four screens per battleship, ten submarines per pack, ...)
 * are the meta compositions from the guides in SOURCES.
 */

export const SCREENS_PER_SHIP = 3;
export const MAX_CARRIERS = 4;
export const DOCKYARD_OUTPUT = 2.5;
export const LINE_CAP = { carrier: 5, capital: 5, screen: 10, sub: 10 };
// shore bombardment: share of the defenders' attack and defense removed per point of heavy and light attack, and the cap
export const BOMBARD = { hg: 0.0005, lg: 0.00025, cap: 0.33 };
// a raiding task force covers this many strategic regions at full efficiency
export const RAID_REGIONS = 1.5;

export const SOURCES = {
  steam117: { name: 'The Ultimate Guide to Navy: Ship Templates and Fleet Composition (Steam guide, patch 1.17, 2026)', url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=2943980823' },
  gf2026: { name: 'HOI4 Navy Guide 2026 (Guides Factory)', url: 'https://guides-factory.com/guides/hoi4-navy-guide-2026' },
  eip: { name: 'Naval Task Force Composition Guide (EIP Gaming, 2023)', url: 'https://eip.gg/hoi4/guides/task-force-compositions/' },
  steamRatio: { name: 'Fleet composition discussion (Steam, 2025)', url: 'https://steamcommunity.com/app/394360/discussions/0/601905151053148700' },
  steamCarriers: { name: 'Max carriers in a task force (Steam discussion)', url: 'https://steamcommunity.com/app/394360/discussions/0/2284960483086350997/' },
  steamSize: { name: 'Optimal task force size (Steam discussion, 2019)', url: 'https://steamcommunity.com/app/394360/discussions/0/1814296907961503224/' },
  pdxDesigns: { name: 'Best ship designs for each task (Paradox forum, 2022)', url: 'https://forum.paradoxplaza.com/forum/threads/whats-the-best-ship-designs-for-each-task-for-the-navy.1506806/' },
  mpGuide: { name: 'An Intermediate Guide to the Navy in Multiplayer (Steam guide)', url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=2654419458' },
  wikiProd: { name: 'Production: naval dockyards (HOI4 wiki)', url: 'https://hoi4.paradoxwikis.com/Production' },
  wikiMissions: { name: 'Naval missions (HOI4 wiki)', url: 'https://hoi4.paradoxwikis.com/Naval_missions' },
  wikiWarfare: { name: 'Naval warfare: strategy (HOI4 wiki)', url: 'https://hoi4.paradoxwikis.com/Naval_warfare' },
  patch117: { name: 'Patch 1.17 notes (HOI4 wiki)', url: 'https://hoi4.paradoxwikis.com/Patch_1.17' },
  pdxDockyards: { name: 'Why limit the dockyards on capital ships (Paradox forum)', url: 'https://forum.paradoxplaza.com/forum/threads/why-limit-the-number-of-dockyard-assignable-to-capital-ships.1157141/' },
};

/** The rules every fleet is built on, with where they come from. */
export const RULES = [
  { text: 'Full screening needs three screens (destroyers or light cruisers) for every capital ship and every carrier. Below that, torpedoes start to reach the battle line.', src: ['gf2026', 'wikiWarfare', 'eip'] },
  { text: 'Full carrier screening needs one capital ship (battleship, battlecruiser or heavy cruiser) for every carrier.', src: ['gf2026'] },
  { text: 'Past four carriers in one battle, each extra carrier loses 20% of its planes, so a task force takes four at most.', src: ['steamCarriers', 'steam117'] },
  { text: 'A task force sails at the speed of its slowest ship, so every design in a fleet is searched with the fleet\'s speed floor.', src: ['steam117', 'steamRatio'] },
  { text: 'A naval dockyard produces 2.5 IC a day and has no production efficiency. A production line takes at most 5 dockyards for a capital ship or carrier and 10 for a screen or submarine, and builds one ship at a time.', src: ['wikiProd', 'pdxDockyards'] },
];

/**
 * Fleet types. A battle fleet is scaled by its carriers or capital ships and gets its screens from the screening
 * rule plus `buffer` spare screens per capital ship and carrier; any other fleet is a number of identical groups of
 * `members`, each its own task force. A slot's `add` adjusts its role's priorities for this fleet, `weights` replaces
 * them.
 */
export const FLEETS = [
  {
    id: 'carrier', group: 'Battle fleets', name: 'Carrier strike force', doctrine: 'Base Strike', mission: 'Strike force',
    blurb: 'Carriers do the killing with their air wings. Two heavy ships per carrier keep the carriers screened, and cruisers and destroyers screen everything.',
    unit: ['carrier', 'carriers'], scale: { start: 4, min: 1, max: 16 }, speed: 30, buffer: 0.5,
    carriers: [{ id: 'cv', role: 'cv', share: 1 }],
    capitalsPerCarrier: 2,
    capitals: [
      { id: 'bc', role: 'bc', share: 1, name: 'Escort battlecruiser', add: { anti_air_attack: 3 } },
      { id: 'ca', role: 'ca_heavy_attack', share: 1, name: 'Escort heavy cruiser', add: { anti_air_attack: 3 } },
    ],
    screens: [
      { id: 'cl_aa', role: 'cl_aa', share: 1 },
      { id: 'cl', role: 'cl_light_attack', share: 1 },
      { id: 'dd', role: 'dd_screen', share: 2 },
    ],
    kpis: ['carrier_size', 'anti_air_attack', 'lg_attack'],
    why: [
      { text: 'One carrier to two heavy ships to eight light cruisers or ten destroyers.', src: ['steam117'] },
      { text: 'Four carriers per task force; a fifth "barely does any damage".', src: ['steam117', 'steamCarriers'] },
      { text: 'Build past the bare three screens per ship so losses mid-battle do not open the carriers to torpedoes.', src: ['gf2026', 'steam117'] },
      { text: 'Never release a ship under 30 knots.', src: ['steamRatio'] },
    ],
  },
  {
    id: 'battleline', group: 'Battle fleets', name: 'Battle line', doctrine: 'Fleet in Being', mission: 'Strike force',
    blurb: 'Battleships carry the heavy guns. Light cruisers kill the enemy screens and destroyers soak up torpedoes, four screens to every battleship.',
    unit: ['battleship', 'battleships'], scale: { start: 6, min: 1, max: 24 }, speed: 20, buffer: 1,
    capitals: [{ id: 'bb', role: 'bb', share: 1 }],
    screens: [{ id: 'cl', role: 'cl_light_attack', share: 1 }, { id: 'dd', role: 'dd_screen', share: 1 }],
    kpis: ['hg_attack', 'lg_attack', 'max_strength'],
    why: [
      { text: 'Six battleships with 24 destroyers: at least three screens per capital ship, with spares.', src: ['eip'] },
      { text: 'One heavy ship to four light cruisers or six destroyers.', src: ['steam117'] },
      { text: 'Fleet in Being is the doctrine for big battles.', src: ['steam117'] },
      { text: '20 knots is the minimum for a strike force.', src: ['steam117'] },
    ],
  },
  {
    id: 'cruiser', group: 'Battle fleets', name: 'Cruiser squadron', doctrine: 'Fleet in Being', mission: 'Strike force',
    blurb: 'Heavy cruisers are the cheapest capital ships. With four light-attack cruisers each they make a fast, cheap fleet that shreds enemy screens.',
    unit: ['heavy cruiser', 'heavy cruisers'], scale: { start: 4, min: 1, max: 20 }, speed: 30, buffer: 1,
    capitals: [{ id: 'ca', role: 'ca_heavy_attack', share: 1 }],
    screens: [{ id: 'cl', role: 'cl_light_attack', share: 1 }],
    kpis: ['lg_attack', 'hg_attack', 'max_strength'],
    why: [
      { text: '"CL is king": light-attack cruisers are the best screens and the best screen killers.', src: ['steamRatio'] },
      { text: 'For each heavy ship, four light cruisers or eight destroyers.', src: ['pdxDesigns', 'steam117'] },
      { text: 'Never release a ship under 30 knots.', src: ['steamRatio'] },
    ],
  },
  {
    id: 'invasion', group: 'Battle fleets', name: 'Invasion support', doctrine: 'Fleet in Being', mission: 'Naval invasion support',
    blurb: 'Battleships with plenty of anti-air escort the landing and bombard the beach, cutting the defenders\' attack and defense by up to 33%.',
    unit: ['battleship', 'battleships'], scale: { start: 4, min: 1, max: 16 }, speed: 20, buffer: 1,
    capitals: [{ id: 'bb', role: 'bb', share: 1, name: 'Bombardment battleship', add: { anti_air_attack: 4 } }],
    screens: [{ id: 'cl_aa', role: 'cl_aa', share: 1 }, { id: 'dd', role: 'dd_screen', share: 3 }],
    kpis: ['bombard', 'anti_air_attack', 'hg_attack'],
    why: [
      { text: 'Old battleships with as much anti-air as they take: off a beach the threat is enemy planes.', src: ['pdxDesigns'] },
      { text: 'Shore bombardment takes 0.05% of the defenders\' attack and defense per point of heavy attack and 0.025% per point of light attack, up to 33% since patch 1.17.', src: ['wikiMissions', 'patch117'] },
      { text: 'At least three screens per capital ship.', src: ['wikiWarfare'] },
    ],
  },
  {
    id: 'wolfpack', group: 'Raiders and support', name: 'Submarine wolfpacks', doctrine: 'Trade Interdiction', mission: 'Convoy raiding',
    blurb: 'Packs of ten convoy raiders, each its own task force: a raiding task force only covers about one and a half strategic regions well.',
    unit: ['pack', 'packs'], scale: { start: 3, min: 1, max: 10 }, speed: 0,
    members: [{ id: 'ss', role: 'ss_raider', cls: 'sub', count: 10 }],
    kpis: ['torpedo_attack', 'regions'],
    why: [
      { text: 'About ten submarines per task force and sea zone, and up to ten task forces under one admiral.', src: ['steam117', 'gf2026'] },
      { text: 'Each raiding task force covers 1.5 strategic regions at full efficiency.', src: ['wikiMissions'] },
      { text: 'Trade Interdiction is the doctrine for navies built around raiding.', src: ['steam117'] },
    ],
  },
  {
    id: 'escort', group: 'Raiders and support', name: 'Convoy escort', doctrine: 'Any', mission: 'Convoy escort',
    blurb: 'Groups of five anti-submarine destroyers with one anti-air ship. Escort efficiency comes from numbers, so cheap hulls win.',
    unit: ['escort group', 'escort groups'], scale: { start: 4, min: 1, max: 20 }, speed: 0,
    members: [{ id: 'dd_asw', role: 'dd_asw', cls: 'screen', count: 5 }, { id: 'dd_aa', role: 'dd_aa', cls: 'screen', count: 1 }],
    kpis: ['sub_attack', 'anti_air_attack'],
    why: [
      { text: 'Five anti-submarine destroyers and one anti-air cruiser or destroyer per group, and at least five anti-submarine destroyers in a region.', src: ['eip'] },
      { text: 'Escort efficiency comes from the number of ships, not their quality.', src: ['wikiWarfare'] },
      { text: 'Group escort destroyers in fives.', src: ['steam117'] },
    ],
  },
  {
    id: 'patrol', group: 'Raiders and support', name: 'Patrol and spotting', doctrine: 'Any', mission: 'Patrol',
    blurb: 'A recon cruiser with radar and floatplanes and four fast picket destroyers per group. Patrols find the enemy so the strike force can engage.',
    unit: ['patrol group', 'patrol groups'], scale: { start: 3, min: 1, max: 12 }, speed: 0,
    members: [
      { id: 'cl_recon', role: 'cl_light_attack', cls: 'screen', count: 1, name: 'Recon cruiser', weights: { surface_detection: 8, sub_detection: 2, naval_speed: 4, lg_attack: 1, build_cost_ic: -4 } },
      { id: 'dd_picket', role: 'dd_screen', cls: 'screen', count: 4, name: 'Picket destroyer', weights: { surface_detection: 6, naval_speed: 5, build_cost_ic: -6 } },
    ],
    kpis: ['surface_detection', 'sub_detection'],
    why: [
      { text: 'The ideal patrol group is one light cruiser and four destroyers.', src: ['mpGuide'] },
      { text: 'A recon cruiser is built purely for surface detection.', src: ['gf2026'] },
      { text: 'A strike force only engages what a patrol has fully spotted.', src: ['wikiMissions'] },
    ],
  },
  {
    id: 'mines', group: 'Raiders and support', name: 'Minelaying flotilla', doctrine: 'Any', mission: 'Minelaying',
    blurb: 'Minelaying submarines lay mines where surface ships would not survive: ten to a flotilla, set never to engage.',
    unit: ['flotilla', 'flotillas'], scale: { start: 1, min: 1, max: 6 }, speed: 0,
    members: [{ id: 'ss_mine', role: 'ss_minelayer', cls: 'sub', count: 10 }],
    kpis: ['mines_planting'],
    why: [
      { text: 'Ten minelaying submarines or ten destroyers; more ships finish a minefield faster.', src: ['eip'] },
      { text: 'Submarines suit minelaying best: cheap and close to risk-free when set never to engage.', src: ['wikiWarfare'] },
      { text: 'A region is saturated at 1,000 mines.', src: ['wikiMissions'] },
    ],
  },
];

/** Every ship slot of a fleet, with the class it fills in battle: carrier, capital, screen or sub. */
export function fleetSlots(fleet) {
  if (fleet.members) return fleet.members;
  return [
    ...(fleet.carriers || []).map((s) => ({ ...s, cls: 'carrier' })),
    ...(fleet.capitals || []).map((s) => ({ ...s, cls: 'capital' })),
    ...(fleet.screens || []).map((s) => ({ ...s, cls: 'screen' })),
  ];
}

/** The priorities a slot's design is searched with, or null for its role's own. */
export function slotWeights(slot, roles) {
  if (slot.weights) return slot.weights;
  if (!slot.add) return null;
  const role = roles.find((r) => r.id === slot.role);
  return role ? { ...role.weights, ...slot.add } : null;
}

/** Class of a design's ship type, which sets how many dockyards one production line takes. */
export function classOf(type) {
  if (type === 'carrier') return 'carrier';
  if (type === 'submarine') return 'sub';
  if (type === 'destroyer' || type === 'light_cruiser') return 'screen';
  return type ? 'capital' : null;
}

/** Largest-remainder split of `total` by `shares`, ties to the first. */
export function apportion(total, shares) {
  const sum = shares.reduce((a, b) => a + b, 0);
  if (!sum || total <= 0) return shares.map(() => 0);
  const q = shares.map((s) => (total * s) / sum);
  const n = q.map((x) => Math.floor(x + 1e-9));
  let left = total - n.reduce((a, b) => a + b, 0);
  const order = q.map((x, i) => [x - n[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; n[i]++; left--; }
  return n;
}

/**
 * Ship counts for a fleet at a scale (carriers, capital ships or groups). Battle fleets split into task forces of at
 * most four carriers; each task force gets its capital ships per carrier and its screens from the screening rule plus
 * the buffer, so every task force is fully screened on its own. Returns { taskForces: [{ counts, carriers, capitals,
 * screens }], counts: slot id -> ships }.
 */
export function composeFleet(fleet, { scale = fleet.scale.start, buffer = fleet.buffer || 0 } = {}) {
  const n = Math.max(fleet.scale.min, Math.min(fleet.scale.max, Math.round(scale)));
  const slots = fleetSlots(fleet);
  const taskForces = [];
  if (fleet.members) {
    for (let t = 0; t < n; t++) taskForces.push({ counts: Object.fromEntries(fleet.members.map((s) => [s.id, s.count])) });
  } else {
    const carriers = fleet.carriers ? n : 0;
    const tfs = carriers ? Math.ceil(carriers / MAX_CARRIERS) : 1;
    for (let t = 0; t < tfs; t++) {
      const c = carriers ? Math.floor(carriers / tfs) + (t < carriers % tfs ? 1 : 0) : 0;
      const k = carriers ? Math.ceil(fleet.capitalsPerCarrier * c - 1e-9) : n;
      const s = Math.ceil((SCREENS_PER_SHIP + buffer) * (c + k) - 1e-9);
      const counts = {};
      const fill = (list, total) => {
        const split = apportion(total, (list || []).map((x) => x.share));
        (list || []).forEach((x, i) => { counts[x.id] = split[i]; });
      };
      fill(fleet.carriers, c); fill(fleet.capitals, k); fill(fleet.screens, s);
      taskForces.push({ counts, carriers: c, capitals: k, screens: s });
    }
  }
  const counts = Object.fromEntries(slots.map((s) => [s.id, taskForces.reduce((a, tf) => a + (tf.counts[s.id] || 0), 0)]));
  return { scale: n, taskForces, counts, ships: Object.values(counts).reduce((a, b) => a + b, 0) };
}

const SUMMED = ['lg_attack', 'hg_attack', 'torpedo_attack', 'sub_attack', 'anti_air_attack', 'carrier_size', 'mines_planting', 'mines_sweeping', 'max_strength', 'build_cost_ic'];

/** Totals and checks for a composed fleet once its designs are known (designs: slot id -> design, missing while searching). */
export function fleetSummary(fleet, comp, designs) {
  const slots = fleetSlots(fleet);
  const ready = slots.every((s) => !comp.counts[s.id] || designs[s.id]);
  const sum = Object.fromEntries(SUMMED.map((k) => [k, 0]));
  const max = { surface_detection: 0, sub_detection: 0 };
  let speed = Infinity;
  const byClass = { carrier: 0, capital: 0, screen: 0, sub: 0 };
  for (const s of slots) {
    const n = comp.counts[s.id] || 0;
    const d = designs[s.id];
    if (!n) continue;
    byClass[s.cls] += n;
    if (!d) continue;
    for (const k of SUMMED) sum[k] += n * (d.stats[k] || 0);
    for (const k of Object.keys(max)) max[k] = Math.max(max[k], d.stats[k] || 0);
    speed = Math.min(speed, d.stats.naval_speed || 0);
  }
  const bombard = Math.min(BOMBARD.cap, BOMBARD.hg * sum.hg_attack + BOMBARD.lg * sum.lg_attack);
  // per task force: screening of capital ships and carriers, carrier screening by capital ships
  const tfChecks = comp.taskForces.map((tf) => {
    const cls = { carrier: 0, capital: 0, screen: 0, sub: 0 };
    for (const s of slots) {
      const n = tf.counts[s.id] || 0;
      if (n) cls[s.cls] += n;
    }
    const big = cls.carrier + cls.capital;
    return {
      ...cls,
      screening: big ? Math.min(1, cls.screen / (SCREENS_PER_SHIP * big)) : null,
      ratio: big ? cls.screen / big : null,
      carrierScreening: cls.carrier ? Math.min(1, cls.capital / cls.carrier) : null,
    };
  });
  const worst = (k) => tfChecks.reduce((a, t) => (t[k] == null ? a : a == null ? t[k] : Math.min(a, t[k])), null);
  return {
    ready, sum, max, byClass, bombard,
    speed: Number.isFinite(speed) ? speed : null,
    cost: sum.build_cost_ic,
    screening: worst('screening'), ratio: worst('ratio'), carrierScreening: worst('carrierScreening'),
    maxCarriers: Math.max(0, ...tfChecks.map((t) => t.carrier)),
    tfChecks,
  };
}

/**
 * Dockyards per production line so the whole fleet is finished as early as possible: every ship type ends at about
 * the same time and the screens come in step with the ships they screen.
 *
 * items: [{ id, count, cost (IC per ship), cap (most dockyards on one line), cls }]. A line of d dockyards finishes its k-th
 * ship on day k * cost / (d * output), so the fleet's finishing day is one of those values. For a candidate day the
 * fewest dockyards that finish a ship type in time is a small covering knapsack over line sizes 1..cap; the plan is the
 * earliest candidate whose dockyards fit, found by binary search (fewer dockyards are never faster). Ships then go to
 * whichever line would finish them first. Whole dockyards cannot keep every type exactly in step, so while some capital
 * ship or carrier would launch with fewer than three screens afloat per big ship, spare dockyards go to the screen
 * lines that raise that low point most per dockyard.
 *
 * Returns { days, used, spare, lines: [{ id, dockyards, ships, every, finish }], fastest: { days, dockyards },
 * balance (buildBalance) }, or { short: n } when there are fewer dockyards than ship types (each needs a line).
 */
export function planDockyards(items, dockyards, output = DOCKYARD_OUTPUT) {
  const todo = items.filter((e) => e.count > 0 && e.cost > 0);
  if (!todo.length) return null;
  const D = Math.floor(dockyards);
  if (D < todo.length) return { short: todo.length };
  const shipsBy = (e, d, T) => Math.floor((T * d * output) / e.cost + 1e-9);
  // fewest dockyards finishing e.count ships by day T (then fewest lines), and the line sizes that do it
  const need = (e, T) => {
    const n = e.count;
    const best = new Float64Array(n + 1).fill(Infinity); const nLines = new Float64Array(n + 1).fill(Infinity); const pick = new Int32Array(n + 1);
    best[0] = 0; nLines[0] = 0;
    for (let v = 1; v <= n; v++) {
      for (let d = 1; d <= e.cap; d++) {
        const s = shipsBy(e, d, T);
        if (s < 1) continue;
        const r = Math.max(0, v - s);
        const c = d + best[r]; const l = 1 + nLines[r];
        if (c < best[v] || (c === best[v] && l < nLines[v])) { best[v] = c; nLines[v] = l; pick[v] = d; }
      }
    }
    if (!Number.isFinite(best[n])) return null;
    const lines = [];
    for (let v = n; v > 0;) { const d = pick[v]; lines.push(d); v = Math.max(0, v - shipsBy(e, d, T)); }
    return { dockyards: best[n], lines };
  };
  const total = (T) => {
    let s = 0;
    for (const e of todo) { const r = need(e, T); if (!r) return Infinity; s += r.dockyards; }
    return s;
  };
  const cands = new Set();
  for (const e of todo) for (let d = 1; d <= e.cap; d++) for (let k = 1; k <= e.count; k++) cands.add((k * e.cost) / (d * output));
  const times = [...cands].sort((a, b) => a - b);
  // the earliest day any plan can reach: each ship on its own full line
  const tMin = Math.max(...todo.map((e) => e.cost / (e.cap * output)));
  const first = times.findIndex((t) => t >= tMin - 1e-9);
  const fastest = { days: times[first], dockyards: total(times[first]) };
  let lo = first; let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (total(times[mid]) <= D) hi = mid; else lo = mid + 1;
  }
  const T = times[lo];
  const lines = [];
  for (const e of todo) {
    const sizes = need(e, T).lines.sort((a, b) => b - a);
    const done = sizes.map(() => 0);
    for (let k = 0; k < e.count; k++) {
      let at = 0;
      for (let j = 1; j < sizes.length; j++) if ((done[j] + 1) / sizes[j] < (done[at] + 1) / sizes[at] - 1e-12) at = j;
      done[at]++;
    }
    sizes.forEach((d, j) => {
      if (!done[j]) return;
      const every = e.cost / (d * output);
      lines.push({ id: e.id, dockyards: d, ships: done[j], every, finish: done[j] * every });
    });
  }
  // spare dockyards go to the screen lines while a big ship would launch with fewer than full screening afloat
  const cls = Object.fromEntries(todo.map((e) => [e.id, e.cls]));
  const cap = Object.fromEntries(todo.map((e) => [e.id, e.cap]));
  const cost = Object.fromEntries(todo.map((e) => [e.id, e.cost]));
  const resize = (l, d) => { l.dockyards = d; l.every = cost[l.id] / (d * output); l.finish = l.ships * l.every; };
  let spare = D - lines.reduce((a, l) => a + l.dockyards, 0);
  let balance = buildBalance({ lines }, cls);
  while (balance && balance.ratio < SCREENS_PER_SHIP - 1e-9 && spare > 0) {
    // the fewest extra dockyards that lift the low point on each screen line; take the most lift per dockyard
    let best = null;
    for (const l of lines) {
      if (cls[l.id] !== 'screen') continue;
      const d0 = l.dockyards;
      for (let d = d0 + 1; d <= Math.min(cap[l.id], d0 + spare); d++) {
        resize(l, d);
        const b = buildBalance({ lines }, cls);
        if (b.ratio > balance.ratio + 1e-12) {
          const gain = (b.ratio - balance.ratio) / (d - d0);
          if (!best || gain > best.gain + 1e-12) best = { l, d, b, gain };
          break;
        }
      }
      resize(l, d0);
    }
    if (!best) break;
    spare -= best.d - best.l.dockyards;
    resize(best.l, best.d);
    balance = best.b;
  }
  return { days: Math.max(...lines.map((l) => l.finish)), used: D - spare, spare, lines, fastest, balance };
}

/**
 * How balanced the fleet stays while it is built: the fewest screens afloat per capital ship and carrier at any point
 * after the first big ship is launched (ships launched the same day count together), and the day from which it stays
 * at full screening for good (0 when it never drops below). cls: slot id -> class. Returns { ratio, day, big, screens,
 * from } with the counts at the worst moment, or null when the plan has no big ships or no screens.
 */
export function buildBalance(plan, cls) {
  const isBig = (id) => cls[id] === 'carrier' || cls[id] === 'capital';
  const launches = plan.lines.flatMap((l) => Array.from({ length: l.ships }, (_, k) => ({ day: (k + 1) * l.every, id: l.id })));
  if (!launches.some((e) => isBig(e.id)) || !launches.some((e) => cls[e.id] === 'screen')) return null;
  launches.sort((a, b) => a.day - b.day);
  let big = 0; let screens = 0; let worst = null; let from = 0;
  for (let i = 0; i < launches.length;) {
    const day = launches[i].day;
    for (; i < launches.length && launches[i].day <= day + 1e-9; i++) {
      if (isBig(launches[i].id)) big++; else if (cls[launches[i].id] === 'screen') screens++;
    }
    if (!big) continue;
    const ratio = screens / big;
    if (!worst || ratio < worst.ratio - 1e-12) worst = { ratio, day, big, screens };
    if (ratio < SCREENS_PER_SHIP - 1e-9) from = null; else if (from === null) from = day;
  }
  return { ...worst, from };
}

/** Production items for planDockyards: one per ship slot with ships and a design. */
export function lineItems(fleet, comp, designs) {
  return fleetSlots(fleet).filter((s) => comp.counts[s.id] && designs[s.id]).map((s) => ({
    id: s.id, count: comp.counts[s.id], cost: designs[s.id].stats.build_cost_ic, cap: LINE_CAP[classOf(designs[s.id].stats.type)] || LINE_CAP.screen, cls: s.cls,
  }));
}

/** The largest scale whose dockyard plan finishes within `days`; the smallest scale when none does. */
export function fitScale(fleet, designs, { buffer, dockyards, output = DOCKYARD_OUTPUT, days }) {
  for (let n = fleet.scale.max; n > fleet.scale.min; n--) {
    const plan = planDockyards(lineItems(fleet, composeFleet(fleet, { scale: n, buffer }), designs), dockyards, output);
    if (plan && !plan.short && plan.days <= days + 1e-9) return n;
  }
  return fleet.scale.min;
}
