# HOI4 Optimal Division Designer

**Division Desk** finds the best Hearts of Iron IV division template for whatever you want the division to do.
Say what matters (breakthrough, cheap defense, tank killing, soft attack per IC), set your limits, and it finds the
provably best template, explains why it wins, shows how stable that pick is, and shows what the alternatives give up.

Live site: https://hoi-4-optimal-divison-designer.vercel.app/

## What it is for

Working out a strong template by hand means juggling battalion stats, support companies, tech bonuses, doctrines and
tank designs all at once. This tool does that arithmetic from the game's own data and searches the space for you, so you
can compare designs on the trade-offs that matter to you instead of copying a template from a guide.

## Views

The top bar switches between five views, with a fade between them. The command bar under it holds three menus that apply
everywhere: theatre, research year and designer mode. Every panel folds away, and each view has expand/collapse all.

- **Designer**: the template search, in three modes: optimal search, manual design (draft a template by hand and measure it
  against the best) and compare (up to four templates side by side, from the ranked list, your saved templates or the draft).
- **Research**: research by year, plus the full tech tree inline.
- **Doctrine**: recommended doctrines for the role and the full doctrine setup.
- **Equipment**: three tabs. Tanks (the designs in your template, then the best design for every tank role: main battle,
  breakthrough, light, infantry support, tank destroyer, self-propelled gun and anti-air), Aircraft (a role guide for
  fighters, interceptors, heavy fighters, CAS, tactical, naval, torpedo, patrol, strategic, transport, carrier and jet roles,
  by stage of the war, which becomes the proven-best design for every role once the aircraft designer files are extracted)
  and Ships (the proven-best design for every ship role: screen, anti-submarine, torpedo, anti-air and
  mine destroyers, light attack, anti-air, torpedo and minelaying cruisers, heavy cruiser, battleship, battlecruiser,
  super-heavy battleship, fleet and armored carriers, and convoy-raider, minelaying and long-range submarines).
- **Field manual**: where the numbers come from, how the searches work and what they leave out.

## Features

- **Exact search.** Branch and bound over every legal template, with the limits as hard constraints. The same setup
  always gives the same answer, and the page says whether the winner is proven best (to within 0.5%).
- **Goal-driven search.** Pick a role preset (line infantry, defensive wall, breakthrough spearhead, attrition grinder,
  armored punch, tank hunter, cheap mass) or set your own priority sliders, including production cost, manpower, supply and speed.
- **Limits.** Combat width range, minimum organization, minimum armor and a production cost ceiling. An option compares designs
  per combat width so a wider division is not favoured just for being bigger.
- **Real game data.** Units, equipment, technologies, doctrines and tank modules are extracted from the game files. Every DLC is
  assumed owned and there are no mods.
- **Full tech tree picker.** Preset research levels (1936 to 1945 and everything), or open the tree and pick individual techs.
  Picking a tech also researches what it needs. Special-project techs are included.
- **Doctrine picker.** Grand doctrines, subdoctrines per track and how many rewards are unlocked, including special forces
  doctrines and milestones that enlarge columns.
- **Full template model.** Up to five columns, regimental support companies (a column needs three battalions to unlock one),
  divisional support companies, and support companies that boost whole categories of battalions (a recon company lifting
  artillery, for example). The search spreads battalions over spare columns when that unlocks more regimental slots.
- **Allowed units.** Special forces (marines, paratroopers, mountaineers, rangers, amtracs) and cavalry are off by default.
  Switch any unit type on or off before searching.
- **Tank designs chosen with the template.** Every chassis and role gets an exhaustive module search, valued by what
  each stat is worth to the winning division, repeated until the designs and the template stop changing. The highest
  engine and armor upgrade levels your research allows are applied.
- **Opponent matchup.** Optionally score against an opponent (a preset built from your own research, or numbers typed in):
  soft and hard attack against its hardness, defense or breakthrough blocking, armor against piercing, organization damage.
- **Explanations and stability.** Each stat's contribution to the winner's lead over the runner-up, and whether moving any
  priority by 1 or 2 changes the winner.
- **Equipment and scale.** Equipment per division, reliability, supply and trucks, and what fielding N divisions costs and
  how long it takes with your factories.
- **Ranked alternatives.** The best template of each archetype (which column types it uses and its lead battalion), so the
  list shows different kinds of division rather than tweaks of one.
- **Trade-off chart and Pareto front.** Plot any two stats to see what improving one costs in the other; templates on the
  Pareto front of all your priorities are highlighted. Click a point to open that template.
- **Meta widths, scored per frontage.** Raising the width limit does not make the division wider. Combat stats are
  scored per width times how much of a battle's width whole divisions use (Barbarossa terrain widths, one to three
  attack directions, over-width allowed at -2% per 1% over up to 33%, as in the game's defines), and each role pulls
  toward the widths players use for it: infantry 20 or 15, armour 40 or 30, special forces sized to their terrain
  (mountaineers 25 or 15, marines 20 or 15). The pull (5% of every combat stat per width step by default) and the
  meta widths are editable under Limits.
- **Special Forces roles.** Space marines, mountaineers and marines; picking one switches its special battalions on
  and the regular line infantry off.
- **Theatre fit.** Pick a theatre and the menu scores every width by how much of the frontage whole divisions fill, averaged
  over that theatre's terrain and one-, two- and three-direction attacks (50%, 35% and 15% of battles). Optionally the search only considers widths that fit well.
- **Ship designer.** Hulls, modules and naval technology are extracted from the game files. For each role the search is
  exact: a bound that relaxes the score slot by slot (tangents for maximized stats, chords for costs, McCormick envelopes
  for added × multiplied amounts) rules out almost every combination unscored, so all roles solve in about a second.
- **Aircraft designer.** The same exact search over airframes and plane modules, with the designer's rules: engines'
  thrust must cover the weight of the airframe and modules, leftover thrust adds speed, and the main weapon decides the
  plane type. Roles cover fighters, interceptors, heavy fighters, CAS, tactical, naval and strategic bombers, maritime
  patrol, carrier planes and jet fighters. It runs as soon as `src/data/designers.json` holds aircraft designer data.
- **Your own ship and aircraft goals.** Start from any role (it keeps the hull or airframe and what the design must
  carry), set your own priority for every stat and search again.
- **Reliable tanks.** Stacked reliability penalties can push a tank design to 0%; recommended designs keep at least 60%
  whenever any legal design can.
- **Saved templates, copy as text.** Save any result or draft (kept in your browser) and copy a template as plain text.
- **Shareable setups.** The whole setup (goal, limits, research, doctrine, theatre, view) is stored in the link.
- **Manual bonuses.** Type in percentage bonuses for leaders, national spirits and anything else the data does not model.

## How the numbers work

- A unit's stats are the sum of the equipment it needs (best researched variant of each) multiplied by one plus the unit, tech
  and doctrine bonuses. Organization, hit points, recovery and combat width take flat bonuses.
- Attack, defense, breakthrough, hit points, cost, manpower and supply are summed over the template. Organization and recovery are
  averaged. Armor and piercing are 30% of the best line battalion plus 70% of the average; hardness and reliability are averaged
  over line battalions. Speed is the slowest line battalion.
- The score is the sum of priority × ln(stat + a small fixed floor), minus that for costs, so a weight of 6 on soft attack and
  3 on cost means a 10% gain in soft attack is worth a 20% saving in cost. Nothing is calibrated from random samples.
- Limits are hard: a template that breaks one is never a candidate.
- The search is branch and bound (see `src/lib/optimizer.js`). It proves the winner is best to within a 0.5% gain on every
  priority, or says so when its node budget runs out first. `npm run check` compares it with brute force on a small unit set.

## Golden tests

`tests/golden.json` holds division stats read off in-game screenshots; `npm run golden` (also part of `npm run check`) rebuilds
each template with the engine and compares every number. The 18-width infantry template (9 infantry, engineers, support artillery,
1936 research without Interwar Artillery) reproduces the game's soft attack 70, defense 227.7, breakthrough 36.5, organization 50.9
and 910 infantry equipment. A case for the Panzer screenshot is in the file, waiting for its numbers.

## Known limits

Check a result in game before you rely on it. These rules are assumptions, and the app lists them in the Field manual:

- One regimental support company per column, and which column types each can attach to. (A column needs three battalions first.)
- Whether support companies count in the organization average (there is a switch).
- Whether doctrine supply bonuses are fractions of a unit's supply.
- Tank modules are chosen automatically. There is no hand editor yet.
- The matchup model ignores terrain, entrenchment, planning, air support and width penalties.

- Ship data comes from the patch 1.7 game files (the newest set reachable when it was added); re-run `npm run designers`
  on a current install to refresh it.
- Aircraft are a role guide until the aircraft designer files are extracted: the optimizer is built and tested on a
  synthetic airframe (`tests/plane-fixture.json`), but no public copy of the patch 1.12+ files was reachable. Run
  `npm run designers` on a current install to switch it on. The excess-thrust speed (3 km/h per point) is a community
  measurement; check it against the game.
- Terrain combat widths are the Barbarossa-update values (plains and desert 90 +45, forest and jungle 84 +42, hills 80 +40,
  marsh 78 +26, mountain 75 +25, urban 96 +32). Meta widths are community practice, not derived from the game files.

Not modelled: national focus techs, leaders, terrain, the land cruiser, flame tanks and amphibious tank roles.

## Run it locally

```
npm install
npm run dev
```

## Update the data after a patch

```
npm run extract -- "<HOI4 install folder>" --version <patch number>
npm run check
```

`extract` rewrites `src/data/game.json` from `common/units`, `common/technologies`, `common/doctrines` and
`localisation/english`. `check` runs sanity checks on the engine. Commit the new `game.json` and push.

Ship hulls and modules come from a separate extractor:

```
npm run designers -- "<HOI4 install folder>" --version <patch number> --source "<where the files came from>"
```

It reads `common/units/equipment` (ship hulls, airframes and their modules), `common/technologies` (naval and air
technology bonuses) and the English equipment localisation, and rewrites `src/data/designers.json`. On a patch 1.12 or
later install this also adds the aircraft designer, and the Aircraft tab turns from a role guide into the optimizer.

## Deploy

The app is a static Vite build with no server and no environment variables. On Vercel: import the repository, keep the
Vite preset (build command `npm run build`, output directory `dist`) and leave the root directory as the repository root.

## Project layout

- `scripts/`: `paradox.mjs`, `extract.mjs` and `extract-designers.mjs` (game files to JSON), `selfcheck.mjs`, `golden.mjs`.
- `src/data/game.json`, `src/data/designers.json`: the extracted game data; `src/data/air.js`: the aircraft role guide.
- `src/lib/`: the engine (`game.js` units and exhaustive tank designs, `stats.js` template stats, `score.js` the score,
  `optimizer.js` branch and bound, `design.js` designs tuned to the division, `combat.js` the matchup model,
  `designSearch.js` the exact module search shared by `naval.js` (ship designer) and `air.js` (aircraft designer), `tankRoles.js` tank designs by role, `frontage.js` theatre fit), the search worker, presets, share links
  and text helpers.
- `tests/golden.json` and `scripts/golden.mjs`: numbers from in-game screenshots.
- `src/components/`: template view, trade-off chart, tech tree and doctrine pickers, collapsible panels and menus.
- `src/views/`: the five views. `src/App.jsx`: navigation, command bar and shared state.

Hearts of Iron IV is a trademark of Paradox Interactive. This is an unofficial fan tool and is not affiliated with Paradox.
