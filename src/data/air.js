/**
 * Aircraft roles for the By Blood Alone air designer.
 *
 * The game data in this app has no aircraft designer files (the extractor was only run on land data), so these are
 * guidelines rather than computed designs: what each role is for, what to maximize, and which modules do that at each
 * stage of research. Run scripts/extract-designers.mjs on a current install to replace them with computed designs.
 */
export const AIR_ROLES = [
  {
    id: 'fighter', group: 'Air superiority', name: 'Fighter', airframe: 'Small airframe', engines: 1,
    job: 'Wins the air: air superiority and escort missions. Everything else in the air works only if this wins.',
    maximize: ['Air attack', 'Agility', 'Speed'], avoid: ['Bomb locks or bays (dead weight)', 'Range beyond what your fronts need'],
    eras: {
      1936: { main: '2 × Machine guns', secondary: 'Machine guns', special: 'Self-sealing fuel tanks', note: 'Early guns are weak; agility from a light build matters more than an extra gun.' },
      1940: { main: '2 × Heavy machine guns', secondary: 'Heavy machine guns', special: 'Self-sealing fuel tanks, armor plate if you fight over the enemy\'s lines', note: 'Heavy machine guns are the best attack-for-weight trade at this stage.' },
      1944: { main: '2 × Cannon II', secondary: 'Heavy machine guns', special: 'Self-sealing fuel tanks', note: 'Cannons pay off once engines can carry them without losing agility.' },
    },
  },
  {
    id: 'interceptor', group: 'Air superiority', name: 'Interceptor', airframe: 'Small airframe', engines: 1,
    job: 'Defends your own airspace against bombers: as much firepower and speed as possible, range does not matter.',
    maximize: ['Air attack', 'Speed'], avoid: ['Drop tanks and range modules', 'Anything that lowers speed'],
    eras: {
      1936: { main: '2 × Machine guns', secondary: 'Machine guns', special: 'None (keep it light and fast)', note: 'A fighter stripped of range for your home skies.' },
      1940: { main: '2 × Cannon', secondary: 'Heavy machine guns', special: 'Armor plate', note: 'Bombers have lots of defense; cannons get through it.' },
      1944: { main: '2 × Cannon II', secondary: 'Cannon', special: 'Armor plate', note: 'Late bombers are tough; maximum attack per sortie.' },
    },
  },
  {
    id: 'heavy_fighter', group: 'Air superiority', name: 'Heavy fighter', airframe: 'Medium airframe', engines: 2,
    job: 'Long-range escort and air superiority where small fighters cannot reach, such as over the sea or a vast front.',
    maximize: ['Air attack', 'Range', 'Defense'], avoid: ['Turrets (heavy fighters do not need them)'],
    eras: {
      1936: { main: '2 × Heavy machine guns', secondary: 'Machine guns', special: 'Extra fuel tank', note: 'Mostly useful when your fighters cannot reach the fight at all.' },
      1940: { main: '2 × Cannon', secondary: 'Heavy machine guns', special: 'Self-sealing fuel tanks, drop tanks', note: 'Two engines carry heavy guns and fuel together.' },
      1944: { main: '2 × Cannon II', secondary: 'Cannon', special: 'Self-sealing fuel tanks, drop tanks, air radar', note: 'Radar helps it find enemy aircraft on long patrols.' },
    },
  },
  {
    id: 'cas', group: 'Ground support', name: 'Close air support (CAS)', airframe: 'Small airframe', engines: 1,
    job: 'Attacks enemy divisions in battle and lowers their organization. The usual partner of an armored breakthrough.',
    maximize: ['Ground attack', 'Defense (survives anti-air)'], avoid: ['Pure air-to-air guns in every slot'],
    eras: {
      1936: { main: 'Bomb locks', secondary: 'Machine guns', special: 'Armor plate', note: 'Even early CAS adds ground attack the enemy cannot easily stop.' },
      1940: { main: 'Small bomb bay or bomb locks', secondary: 'Rocket rails', special: 'Armor plate, dive brakes', note: 'Dive brakes raise ground attack; armor keeps it alive over anti-air.' },
      1944: { main: 'Small bomb bay', secondary: 'Rocket rails', special: 'Armor plate, dive brakes', note: 'Rockets add more ground attack once researched.' },
    },
  },
  {
    id: 'tac', group: 'Ground support', name: 'Tactical bomber', airframe: 'Medium airframe', engines: 2,
    job: 'A generalist: ground support, logistics strikes and light strategic bombing in one design.',
    maximize: ['Ground attack', 'Strategic bombing', 'Defense'], avoid: ['Fighter guns in the bomb slots'],
    eras: {
      1936: { main: 'Medium bomb bay', secondary: 'Defensive turret', special: 'Bomb sight', note: 'Cheaper than a strategic bomber and useful at the front.' },
      1940: { main: 'Medium bomb bay', secondary: 'Defensive turret', special: 'Bomb sight, self-sealing fuel tanks', note: 'Turrets let it survive without perfect escort.' },
      1944: { main: 'Medium bomb bay', secondary: 'Defensive turret', special: 'Bomb sight, armor plate', note: '' },
    },
  },
  {
    id: 'naval_bomber', group: 'Naval', name: 'Naval bomber', airframe: 'Small airframe', engines: 1,
    job: 'Sinks ships from land bases. The cheapest way to contest a sea you cannot win with a navy.',
    maximize: ['Naval attack', 'Naval targeting'], avoid: ['Ground bombs'],
    eras: {
      1936: { main: 'Torpedo mounting', secondary: 'Machine guns', special: 'Extra fuel tank', note: 'Torpedoes do far more damage to ships than bombs.' },
      1940: { main: 'Torpedo mounting', secondary: 'Heavy machine guns', special: 'Self-sealing fuel tanks, drop tanks', note: 'Range decides how far out to sea it can strike.' },
      1944: { main: 'Torpedo mounting', secondary: 'Heavy machine guns', special: 'Air radar, drop tanks', note: 'Radar improves naval targeting.' },
    },
  },
  {
    id: 'medium_naval', group: 'Naval', name: 'Medium torpedo bomber', airframe: 'Medium airframe', engines: 2,
    job: 'Longer-range naval strikes with more torpedoes per plane.',
    maximize: ['Naval attack', 'Range'], avoid: ['Ground bombs'],
    eras: {
      1936: { main: 'Torpedo mounting', secondary: 'Defensive turret', special: 'Extra fuel tank', note: '' },
      1940: { main: 'Torpedo mounting', secondary: 'Defensive turret', special: 'Drop tanks, self-sealing fuel tanks', note: '' },
      1944: { main: 'Torpedo mounting', secondary: 'Defensive turret', special: 'Air radar, drop tanks', note: '' },
    },
  },
  {
    id: 'maritime_patrol', group: 'Naval', name: 'Maritime patrol plane', airframe: 'Large airframe', engines: 4,
    job: 'Finds enemy fleets and submarines for your navy and naval bombers, and hunts submarines itself.',
    maximize: ['Naval detection', 'Range'], avoid: ['Heavy bomb loads'],
    eras: {
      1936: { main: 'Small bomb bay (depth charges)', secondary: 'Defensive turret', special: 'Extra fuel tank, radio navigation', note: '' },
      1940: { main: 'Small bomb bay', secondary: 'Defensive turret', special: 'Air radar, extra fuel tank', note: 'Air radar is what makes this role worth building.' },
      1944: { main: 'Small bomb bay', secondary: 'Defensive turret', special: 'Air radar, extra fuel tank, radio navigation', note: '' },
    },
  },
  {
    id: 'strategic', group: 'Strategic', name: 'Strategic bomber', airframe: 'Large airframe', engines: 4,
    job: 'Destroys factories, infrastructure and resources far behind the front.',
    maximize: ['Strategic bombing', 'Defense', 'Range'], avoid: ['Ground attack modules'],
    eras: {
      1936: { main: 'Large bomb bay', secondary: 'Defensive turret', special: 'Bomb sight, radio navigation', note: 'Expensive; only worth it with a large industry.' },
      1940: { main: '2 × Large bomb bay', secondary: '2 × Defensive turret', special: 'Bomb sight, radio navigation, self-sealing fuel tanks', note: 'Turrets and armor matter as much as bombs: unescorted bombers die.' },
      1944: { main: '2 × Large bomb bay', secondary: '2 × Defensive turret', special: 'Bomb sight, radio navigation, armor plate', note: '' },
    },
  },
  {
    id: 'transport', group: 'Strategic', name: 'Transport plane', airframe: 'Large airframe', engines: 4,
    job: 'Paradrops and air supply to encircled or remote divisions.',
    maximize: ['Range', 'Reliability'], avoid: ['Weapons'],
    eras: {
      1936: { main: 'Cargo (no weapons)', secondary: '—', special: 'Extra fuel tank', note: '' },
      1940: { main: 'Cargo (no weapons)', secondary: '—', special: 'Extra fuel tank, radio navigation', note: '' },
      1944: { main: 'Cargo (no weapons)', secondary: '—', special: 'Extra fuel tank, radio navigation', note: '' },
    },
  },
  {
    id: 'carrier_fighter', group: 'Carrier', name: 'Carrier fighter', airframe: 'Small airframe (carrier variant)', engines: 1,
    job: 'Protects the carrier fleet from enemy carrier strikes and naval bombers.',
    maximize: ['Air attack', 'Agility'], avoid: ['Bombs'],
    eras: {
      1936: { main: '2 × Machine guns', secondary: 'Machine guns', special: 'Self-sealing fuel tanks', note: 'Carrier decks limit wings, so every fighter has to count.' },
      1940: { main: '2 × Heavy machine guns', secondary: 'Heavy machine guns', special: 'Self-sealing fuel tanks', note: '' },
      1944: { main: '2 × Cannon II', secondary: 'Heavy machine guns', special: 'Self-sealing fuel tanks', note: '' },
    },
  },
  {
    id: 'carrier_naval', group: 'Carrier', name: 'Carrier naval bomber', airframe: 'Small airframe (carrier variant)', engines: 1,
    job: 'The carrier fleet\'s strike arm: torpedoes against enemy ships.',
    maximize: ['Naval attack'], avoid: ['Ground bombs'],
    eras: {
      1936: { main: 'Torpedo mounting', secondary: 'Machine guns', special: 'None', note: '' },
      1940: { main: 'Torpedo mounting', secondary: 'Heavy machine guns', special: 'Self-sealing fuel tanks', note: '' },
      1944: { main: 'Torpedo mounting', secondary: 'Heavy machine guns', special: 'Air radar', note: '' },
    },
  },
  {
    id: 'carrier_cas', group: 'Carrier', name: 'Carrier CAS', airframe: 'Small airframe (carrier variant)', engines: 1,
    job: 'Supports naval invasions and coastal battles from the carrier.',
    maximize: ['Ground attack'], avoid: ['Torpedoes'],
    eras: {
      1936: { main: 'Bomb locks', secondary: 'Machine guns', special: 'Armor plate', note: '' },
      1940: { main: 'Small bomb bay', secondary: 'Rocket rails', special: 'Dive brakes', note: '' },
      1944: { main: 'Small bomb bay', secondary: 'Rocket rails', special: 'Dive brakes, armor plate', note: '' },
    },
  },
  {
    id: 'jet_fighter', group: 'Late war', name: 'Jet fighter', airframe: 'Small jet airframe', engines: 1,
    job: 'Late-war air superiority: speed no piston fighter can match.',
    maximize: ['Speed', 'Air attack'], avoid: ['Range modules (jets burn fuel quickly)'],
    eras: {
      1936: null,
      1940: null,
      1944: { main: '2 × Cannon II', secondary: 'Cannon', special: 'Self-sealing fuel tanks', note: 'Needs jet engine research; until then build piston fighters.' },
    },
  },
];

export const AIR_ERAS = [1936, 1940, 1944];
export const eraFor = (year) => (year >= 1944 ? 1944 : year >= 1940 ? 1940 : 1936);
