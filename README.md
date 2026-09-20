# HOI4 Optimal Division Designer

**Division Desk** finds the best Hearts of Iron IV division template for whatever you want the division to do.
Say what matters (breakthrough, cheap defense, tank killing, soft attack per IC), set your limits, and it searches
hundreds of thousands of templates, shows the best few, and shows what each one gives up.

Live site: https://hoi-4-optimal-divison-designer.vercel.app/

## What it is for

Working out a strong template by hand means juggling battalion stats, support companies, tech bonuses, doctrines and
tank designs all at once. This tool does that arithmetic from the game's own data and searches the space for you, so you
can compare designs on the trade-offs that matter to you instead of copying a template from a guide.

## Features

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
- **Full template model.** Up to five columns, regimental support companies, divisional support companies, and support
  companies that boost whole categories of battalions (a recon company lifting artillery, for example).
- **Tank designer.** Tank battalions and self-propelled support use designs built from the modules you have researched, at the
  highest engine and armor upgrade levels your research allows.
- **Ranked alternatives.** The top designs are genuinely different from each other, each with its full stats.
- **Trade-off chart.** Plot any two stats to see what improving one costs in the other, and click a point to open that template.
- **Shareable setups.** The whole setup (goal, limits, research, doctrine) is stored in the link.
- **Manual bonuses.** Type in percentage bonuses for leaders, national spirits and anything else the data does not model.

## How the numbers work

- A unit's stats are the sum of the equipment it needs (best researched variant of each) multiplied by one plus the unit, tech
  and doctrine bonuses. Organization, hit points, recovery and combat width take flat bonuses.
- Attack, defense, breakthrough, hit points, cost, manpower and supply are summed over the template. Organization and recovery are
  averaged. Armor, piercing and hardness are averaged over line battalions. Speed is the slowest line battalion.
- The search compares stats by percentage change, so a weight of 6 on soft attack and 3 on cost means a 10% gain in soft attack is
  worth a 20% saving in cost.
- The search is heuristic (seeded hill climbing from many starting points). It finds very good templates but does not prove that a
  result is the single best possible.

## Known limits

Check a result in game before you rely on it. These rules are assumptions, and the app lists them under "Data and assumptions":

- One regimental support company per column, and which column types each can attach to.
- Whether support companies count in the organization average (there is a switch).
- Whether doctrine supply bonuses are fractions of a unit's supply.
- Tank modules are chosen automatically. There is no hand editor yet.

Not modelled: national focus techs, leaders, terrain, equipment stockpiles, the land cruiser, flame tanks and amphibious tank roles.

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

## Deploy

The app is a static Vite build with no server and no environment variables. On Vercel: import the repository, keep the
Vite preset (build command `npm run build`, output directory `dist`) and leave the root directory as the repository root.

## Project layout

- `scripts/`: `paradox.mjs` and `extract.mjs` (game files to JSON), `selfcheck.mjs`.
- `src/data/game.json`: the extracted game data.
- `src/lib/`: the engine (`game.js`, `stats.js`, `optimizer.js`), the search worker, presets, share links and text helpers.
- `src/components/`: template view, trade-off chart, tech tree and doctrine pickers.
- `src/App.jsx`: the page.

Hearts of Iron IV is a trademark of Paradox Interactive. This is an unofficial fan tool and is not affiliated with Paradox.
