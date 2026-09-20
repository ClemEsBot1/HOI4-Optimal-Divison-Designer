# Division Desk: data update

Numbers now come from the game's own files instead of the 2023 wiki snapshot.

## Updating the data

```
node scripts/extract.mjs "<HOI4 install folder>" --version <patch number>
node scripts/selfcheck.mjs
```

The first command rewrites `src/data/game.json`. The second checks the engine against it.
Point it at the folders separately with `--units`, `--technologies`, `--doctrines` and `--loc` if you only have copies of them.
Add `"extract": "node scripts/extract.mjs"` to `package.json` scripts if you want `npm run extract`.

Assumed: every DLC owned, no mods, English names, focus-only (national) techs left out.

## Files

- `scripts/paradox.mjs`, `scripts/extract.mjs`: parse the game files into `src/data/game.json`.
- `src/lib/game.js`: tech tree editing, availability, doctrine modifiers, tank designer, unit stats.
- `src/lib/stats.js`: stat list and division evaluation. `src/lib/optimizer.js`: the search. `src/lib/worker.js`: runs it off the main thread.
- `src/lib/presets.js`, `format.js`, `describe.js`: roles, share links, text summaries.
- `src/components/TechPicker.jsx`, `DoctrinePicker.jsx` (+ `TechPicker.css`): the tree and doctrine pickers.
- `src/App.jsx`: wired to all of the above.

`src/data/units.js` is no longer used and can be deleted.

## Unverified rules (check in game)

- One regimental support company per column, and which column types each can attach to.
- Support companies counting in the organization average (switch in the sidebar).
- Doctrine `supply_consumption` values treated as fractions of the unit's supply.
- Tank modules are chosen automatically; there is no hand editor yet.
