import type { BulkCatalogKind } from './catalog-bulk'

export interface CatalogSeedRow {
  key: string
  nameEn: string
  nameTr: string
  aliases: string[]
  isEvent: boolean
  group: string
  multiplier: number | null
}

type TowerSeedTuple = [key: string, nameEn: string, nameTr: string, aliases?: string[]]

/**
 * Curated TDS roster for the admin catalog. Existing starter keys (operator, merc-base, ...) are
 * kept verbatim so a bulk run updates those rows instead of creating a second key for the same
 * tower. Names are intentionally editable: the admin can fix a label without touching the key.
 */
const TOWER_ROWS: TowerSeedTuple[] = [
  ['scout', 'Scout', 'İzci'],
  ['sniper', 'Sniper', 'Keskin Nişancı'],
  ['paintballer', 'Paintballer', 'Paintballer'],
  ['demoman', 'Demoman', 'Bombacı'],
  ['boomerang', 'Boomerang', 'Bumerang'],
  ['soldier', 'Soldier', 'Asker'],
  ['slime-trooper', 'Slime Trooper', 'Slime Trooper', ['slimer', 'slime']],
  ['freezer', 'Freezer', 'Dondurucu'],
  ['assassin', 'Assassin', 'Suikastçı'],
  ['militant', 'Militant', 'Militan'],
  ['shotgunner', 'Shotgunner', 'Pompacı'],
  ['hunter', 'Hunter', 'Hunter'],
  ['pyromancer', 'Pyromancer', 'Pyromancer'],
  ['ace-pilot', 'Ace Pilot', 'Pilot'],
  ['medic', 'Medic', 'Medik'],
  ['farm', 'Farm', 'Çiftlik'],
  ['electroshocker', 'Electroshocker', 'Elektroşokçu', ['electro']],
  ['rocketeer', 'Rocketeer', 'Roketçi', ['rocket']],
  ['trapper', 'Trapper', 'Tuzakçı'],
  ['military-base', 'Military Base', 'Askeri Üs', ['mil base']],
  ['crook-boss', 'Crook Boss', 'Çete Patronu'],
  ['commander', 'Commander', 'Komutan'],
  ['warden', 'Warden', 'Gardiyan'],
  ['cowboy', 'Cowboy', 'Kovboy'],
  ['dj-booth', 'DJ Booth', 'DJ Kabini', ['dj', 'djbooth']],
  ['tesla', 'Tesla', 'Tesla'],
  ['saboteur', 'Saboteur', 'Sabotajcı'],
  ['minigunner', 'Minigunner', 'Minigunner', ['minigun']],
  ['ranger', 'Ranger', 'Avcı'],
  ['pursuit', 'Pursuit', 'Takipçi'],
  ['gatling-gun', 'Gatling Gun', 'Gatling', ['gattling gun']],
  ['turret', 'Turret', 'Taret'],
  ['mortar', 'Mortar', 'Havan'],
  ['merc-base', 'Mercenary Base', 'Paralı Üs', ['merc base', 'mercbase', 'merc', 'mercs']],
  ['brawler', 'Brawler', 'Brawler'],
  ['necromancer', 'Necromancer', 'Nekromanser', ['necro']],
  ['accelerator', 'Accelerator', 'Hızlandırıcı', ['accel']],
  ['engineer', 'Engineer', 'Mühendis'],
  ['hacker', 'Hacker', 'Hacker'],
  ['operator', 'Operator', 'Operatör', ['operatör']],
  ['juggernaut', 'Juggernaut', 'Juggernaut', ['jug']],
  ['kingpin', 'Kingpin', 'Kingpin'],
  ['gladiator', 'Gladiator', 'Gladyatör', ['glad']],
  ['commando', 'Commando', 'Komando'],
  ['slasher', 'Slasher', 'Kesici'],
  ['frost-blaster', 'Frost Blaster', 'Buz Patlatıcı', ['frost']],
  ['archer', 'Archer', 'Okçu'],
  ['swarmer', 'Swarmer', 'Swarmer', ['swarm']],
  ['toxic-gunner', 'Toxic Gunner', 'Zehirli Nişancı', ['toxic']],
  ['sledger', 'Sledger', 'Balyozcu', ['sledge']],
  ['executioner', 'Executioner', 'Cellat'],
  ['elf-camp', 'Elf Camp', 'Elf Kampı'],
  ['jester', 'Jester', 'Şakacı'],
  ['cryomancer', 'Cryomancer', 'Buz Büyücüsü', ['cryo']],
  ['hallow-punk', 'Hallow Punk', 'Hallow Punk'],
  ['harvester', 'Harvester', 'Hasatçı'],
  ['elementalist', 'Elementalist', 'Elementalist'],
  ['firework-technician', 'Firework Technician', 'Havai Fişek Teknisyeni', ['firework', 'technician']],
  ['biologist', 'Biologist', 'Biyolog'],
  ['warlock', 'Warlock', 'Büyücü'],
  ['spotlight-tech', 'Spotlight Tech', 'Spotlight Tech', ['spotlight', 'tech']],
  ['war-machine', 'War Machine', 'Savaş Makinesi'],
  ['mecha-base', 'Mecha Base', 'Mecha Üssü'],
  ['snowballer', 'Snowballer', 'Kartopu Atıcı'],
  ['golden-scout', 'Golden Scout', 'Altın İzci'],
  ['golden-soldier', 'Golden Soldier', 'Altın Asker'],
  ['golden-demoman', 'Golden Demoman', 'Altın Bombacı'],
  ['golden-pyromancer', 'Golden Pyromancer', 'Altın Pyromancer'],
  ['golden-minigunner', 'Golden Minigunner', 'Altın Minigunner'],
  ['golden-crook-boss', 'Golden Crook Boss', 'Altın Çete Patronu'],
  ['golden-cowboy', 'Golden Cowboy', 'Altın Kovboy'],
  ['golden-snowballer', 'Golden Snowballer', 'Altın Kartopu Atıcı']
]

type MapSeedTuple = [key: string, name: string, isEvent?: boolean]

/** 2026 current map catalog: Regular, Community, Special, Hardcore, Story, PVP, Sandbox and
 *  Event sections from the TDS wiki. Removed, Unreleased, Unavailable and the Tutorial/Dev
 *  sandbox rows are excluded; Event-only maps carry the flag. */
const MAP_ROWS: MapSeedTuple[] = [
  ['abandoned-city', "Abandoned City"],
  ['abyssal-trench', "Abyssal Trench"],
  ['autumn-falling', "Autumn Falling"],
  ['black-spot-exchange', "Black Spot Exchange"],
  ['candy-valley', "Candy Valley"],
  ['cataclysm', "Cataclysm"],
  ['chess-board', "Chess Board"],
  ['construction-crazy', "Construction Crazy"],
  ['coral-deep', "Coral Deep"],
  ['crossroads', "Crossroads"],
  ['crystal-cave', "Crystal Cave"],
  ['cyber-city', "Cyber City"],
  ['dead-ahead', "Dead Ahead"],
  ['deserted-village', "Deserted Village"],
  ['dusty-bridges', "Dusty Bridges"],
  ['farm-lands', "Farm Lands"],
  ['forest-camp', "Forest Camp"],
  ['forgetten-docks', "Forgetten Docks"],
  ['four-seasons', "Four Seasons"],
  ['fungi-island', "Fungi Island"],
  ['gilded-path', "Gilded Path"],
  ['grass-isle', "Grass Isle"],
  ['harbor', "Harbor"],
  ['hot-spot', "Hot Spot"],
  ['iceville', "Iceville"],
  ['infernal-abyss', "Infernal Abyss"],
  ['lay-by', "Lay By"],
  ['lighthaos', "Lighthaos"],
  ['marshlands', "Marshlands"],
  ['mason-arch', "Mason Arch"],
  ['medieval-times', "Medieval Times"],
  ['meltdown', "Meltdown"],
  ['midnight-issue', "Midnight Issue"],
  ['moon-base', "Moon Base"],
  ['nether', "Nether"],
  ['necropolis', "Necropolis"],
  ['night-station', "Night Station"],
  ['northern-lights', "Northern Lights"],
  ['pier-pressure', "Pier Pressure"],
  ['portland', "Portland"],
  ['retro-crossroads', "Retro Crossroads"],
  ['retro-lighthouse', "Retro Lighthouse"],
  ['retro-rocket-arena', "Retro Rocket Arena"],
  ['retro-stained-temple', "Retro Stained Temple"],
  ['retro-the-heights', "Retro The Heights"],
  ['retro-zone', "Retro Zone"],
  ['rocket-arena', "Rocket Arena"],
  ['ruby-escort', "Ruby Escort"],
  ['sacred-mountains', "Sacred Mountains"],
  ['simplicity', "Simplicity"],
  ['sky-islands', "Sky Islands"],
  ['space-city', "Space City"],
  ['spring-fever', "Spring Fever"],
  ['stained-temple', "Stained Temple"],
  ['sugar-rush', "Sugar Rush"],
  ['summer-castle', "Summer Castle"],
  ['the-heights', "The Heights"],
  ['toyboard', "Toyboard"],
  ['tropical-industries', "Tropical Industries"],
  ['tropical-isles', "Tropical Isles"],
  ['u-turn', "U-Turn"],
  ['winter-abyss', "Winter Abyss"],
  ['winter-bridges', "Winter Bridges"],
  ['winter-stronghold', "Winter Stronghold"],
  ['wrecked-battlefield', "Wrecked Battlefield"],
  ['wrecked-battlefield-ii', "Wrecked Battlefield II"],
  ['area-52', "Area 52"],
  ['atlas-colosseum', "Atlas Colosseum"],
  ['derelict-outpost', "Derelict Outpost"],
  ['enchanted-forest', "Enchanted Forest"],
  ['happy-home-of-robloxia', "Happy Home of Robloxia"],
  ['honey-valley', "Honey Valley"],
  ['legacy-space-city', "Legacy Space City"],
  ['legacy-simplicity', "Legacy Simplicity"],
  ['legacy-retro-zone', "Legacy Retro Zone"],
  ['musaceae-kingdom', "Musaceae Kingdom"],
  ['the-heavens', "The Heavens"],
  ['badlands-ii', "Badlands II"],
  ['pizza-party', "Pizza Party"],
  ['polluted-wasteland-ii', "Polluted Wasteland II"],
  ['outskirts-commune', "Outskirts Commune"],
  ['unknown-garden', "Unknown Garden"],
  ['wretched-front', "Wretched Front"],
  ['abandoned-city-story', "Abandoned City (Story Mode)"],
  ['severing-connection', "Severing Connection"],
  ['excavation-point', "Excavation Point"],
  ['crash-course', "Crash Course"],
  ['desert-oasis', "Desert Oasis"],
  ['distant-shapes', "Distant Shapes"],
  ['judging-hall', "Judging Hall"],
  ['laser-stadium', "Laser Stadium"],
  ['opulent-remains', "Opulent Remains"],
  ['warm-land', "Warm Land"],
  ['badlands', "Badlands"],
  ['classic-candy-cane-lane', "Classic Candy Cane Lane"],
  ['classic-castle', "Classic Castle"],
  ['classic-forest-camp', "Classic Forest Camp"],
  ['classic-island-chaos', "Classic Island Chaos"],
  ['classic-winter', "Classic Winter"],
  ['headache-headquarters', "Headache Headquarters"],
  ['rotfield', "Rotfield"],
  ['area-51', "Area 51", true],
  ['nightmare-carnival', "Nightmare Carnival", true],
  ['village-of-despair', "Village of Despair", true],
  ['eggy-island', "Eggy Island", true],
  ['trick-or-threat-town', "Trick or Threat Town", true],
  ['outpost-32', "Outpost 32", true],
  ['foggy-forest', "Foggy Forest", true],
  ['tower-outskirts', "Tower Outskirts", true],
  ['totality-tower', "Totality Tower", true],
  ['d00m-s-revenge', "D00M's Revenge", true],
  ['cold-ambush', "Cold Ambush", true],
  ['a-dark-tale', "A Dark Tale", true],
  ['the-haunted-past', "The Haunted Past", true],
  ['the-great-finale', "The Great Finale", true],
  ['krampus-frosthold', "Krampus Frosthold", true],
  ['huevous-hunt', "Huevous Hunt", true],
  ['failed-gateway', "Failed Gateway", true],
  ['the-nightmare-realm', "The Nightmare Realm", true],
  ['containment', "Containment", true],
  ['pls-donate', "Pls Donate", true],
  ['korblox-temple', "Korblox Temple", true],
  ['baseplate-l', "Baseplate-L", true],
  ['baseplate-w', "Baseplate-W", true],
  ['bathroom-approach', "Bathroom Approach", true],
  ['sk8-p4rk', "Sk8 P4rk", true],
  ['nil-zone', "Nil Zone", true],
  ['outpost-16', "Outpost 16", true],
  ['banlands', "Banlands", true],
  ['blind-faith', "Blind Faith", true],
  ['the-narratorium', "The Narratorium", true],
  ['backyard-beginnings', "Backyard Beginnings", true],
  ['competition-court', "Competition Court", true],
  ['victory-field', "Victory Field", true]
]

type MutatorSeedTuple = [key: string, name: string, group: string, multiplier: number | null]

/**
 * Current modifiers from the TDS wiki. `multiplier` is the reward coefficient from the wiki's
 * rewards_increase (1.30 = +30%); null means the modifier has no numeric reward boost. Removed
 * modifiers are deliberately absent.
 */
const MUTATOR_ROWS: MutatorSeedTuple[] = [
  ['nuclear', 'Nuclear', 'Maps and Modes', 1.3],
  ['badlands-modifier', 'Badlands', 'Maps and Modes', 1.2],
  ['pizza-party-modifier', 'Pizza Party', 'Maps and Modes', 1.1],
  ['lost-souls', 'Lost Souls', 'Maps and Modes', null],
  ['all-paths', 'All Paths', 'Maps and Modes', 1.1],
  ['mutation', 'Mutation', 'Maps and Modes', 1.2],
  ['hp-locked', 'HP Locked', 'Maps and Modes', 1.2],
  ['cowboy-modifier', 'Cowboy', 'Maps and Modes', null],
  ['space-suit', 'Space Suit', 'Maps and Modes', null],
  ['scuba-gear', 'Scuba Gear', 'Maps and Modes', null],
  ['blood', 'Blood', 'Maps and Modes', null],
  ['talk-like-a-pirate-day', 'Talk Like a Pirate Day', 'Maps and Modes', null],
  ['farm-banned', 'Farm Banned', 'Maps and Modes', null],
  ['gatling-gun-banned', 'Gatling Gun Banned', 'Maps and Modes', null],
  ['random-tower-positions', 'Random Tower Positions', 'Maps and Modes', null],
  ['tanky-enemies', 'Tanky Enemies', 'Maps and Modes', null],
  ['path-spawn-even', 'Path Spawn Even', 'Maps and Modes', null],
  ['hidden-enemies', 'Hidden Enemies', 'Challenge Trials', 1.1],
  ['glass', 'Glass', 'Challenge Trials', 1.05],
  ['jailed-towers', 'Jailed Towers', 'Challenge Trials', 1.2],
  ['exploding-enemies', 'Exploding Enemies', 'Challenge Trials', 1.1],
  ['limitation-makes-creativity', 'Limitation Makes Creativity', 'Challenge Trials', 1.1],
  ['committed', 'Committed', 'Challenge Trials', 1.1],
  ['healthy-enemies', 'Healthy Enemies', 'Challenge Trials', 1.3],
  ['speedy-enemies', 'Speedy Enemies', 'Challenge Trials', 1.25],
  ['fog', 'Fog', 'Challenge Trials', 1.2],
  ['flying-enemies', 'Flying Enemies', 'Challenge Trials', 1.15],
  ['broke', 'Broke', 'Challenge Trials', 1.3],
  ['quarantine', 'Quarantine', 'Challenge Trials', 1.2],
  ['inflation', 'Inflation', 'Challenge Trials', 1.3],
  ['juggernaut-modifier', 'Juggernaut', 'Challenge Maps', null],
  ['back-to-basics', 'Back to Basics', 'Challenge Maps', null],
  ['legion-modifier', 'Legion', 'Challenge Maps', null],
  ['oops-all-slimes', 'Oops all slimes!', 'Challenge Maps', null],
  ['vanguard-modifier', 'Vanguard', 'Challenge Maps', null],
  ['fireworks', 'Fireworks', 'Day Based', null],
  ['halloween', 'Halloween', 'Day Based', null],
  ['birthday', 'Birthday', 'Day Based', null],
  ['battlepass-boost', 'Battlepass Boost', 'Reward Boosters', 1.5],
  ['xp-boost', 'XP Boost', 'Reward Boosters', 1.5],
  ['vip-boost', 'VIP Boost', 'Reward Boosters', 1.25],
  ['vip-plus-boost', 'VIP+ Boost', 'Reward Boosters', 1.75],
  ['death', 'Death', 'Curses', 1.2],
  ['justice', 'Justice', 'Curses', null],
  ['temperance', 'Temperance', 'Curses', null],
  ['the-chariot', 'The Chariot', 'Curses', null],
  ['the-fool', 'The Fool', 'Curses', null],
  ['the-moon', 'The Moon', 'Curses', null],
  ['the-star', 'The Star', 'Curses', null],
  ['the-sun', 'The Sun', 'Curses', null],
  ['the-tower', 'The Tower', 'Curses', null],
  ['brain-rot', 'Brain Rot', 'Sandbox Exclusive', 1.5],
  ['retro-death', 'Retro Death', 'Sandbox Exclusive', null],
  ['classic-oof', 'Classic Oof', 'Sandbox Exclusive', null],
  ['small', 'Small', 'Sandbox Exclusive', null],
  ['boss-modifier', 'Boss', 'Sandbox Exclusive', 1.4],
  ['april-fools-2022', 'April fools 2022', 'Sandbox Exclusive', 1.5],
  ['double-health', 'Double Health', 'Sandbox Exclusive', null],
  ['legacy', 'Legacy', 'Sandbox Exclusive', null]
]

export const TOWER_SEED: CatalogSeedRow[] = TOWER_ROWS.map(([key, nameEn, nameTr, aliases]) => ({
  key,
  nameEn,
  nameTr,
  aliases: aliases ?? [],
  isEvent: false,
  group: '',
  multiplier: null
}))

export const MAP_SEED: CatalogSeedRow[] = MAP_ROWS.map(([key, name, isEvent]) => ({
  key,
  nameEn: name,
  nameTr: name,
  aliases: [],
  isEvent: isEvent === true,
  group: '',
  multiplier: null
}))

export const MUTATOR_SEED: CatalogSeedRow[] = MUTATOR_ROWS.map(([key, name, group, multiplier]) => ({
  key,
  nameEn: name,
  nameTr: name,
  aliases: [],
  isEvent: false,
  group,
  multiplier
}))

export function catalogPresetRows(kind: BulkCatalogKind): CatalogSeedRow[] | null {
  if (kind === 'towers') return TOWER_SEED
  if (kind === 'maps') return MAP_SEED
  return MUTATOR_SEED
}

export function catalogPresetText(kind: BulkCatalogKind): string | null {
  const rows = catalogPresetRows(kind)
  if (!rows) return null
  const header = kind === 'maps'
    ? '# TDS harita listesi · key | Türkçe | English | | event'
    : kind === 'mutators'
      ? '# TDS modifier listesi · key | Türkçe | English | alias | group | kat sayısı'
      : '# TDS kule listesi · key | Türkçe | English | alias, alias'
  const lines = rows.map((row) => {
    if (kind === 'maps') {
      return `${row.key} | ${row.nameTr} | ${row.nameEn} | | ${row.isEvent ? 'event' : ''}`
    }
    if (kind === 'mutators') {
      return `${row.key} | ${row.nameTr} | ${row.nameEn} | ${row.aliases.join(', ')} | ${row.group} | ${row.multiplier === null ? '' : String(row.multiplier)}`
    }
    return `${row.key} | ${row.nameTr} | ${row.nameEn} | ${row.aliases.join(', ')}`
  })
  return [
    header,
    '# Hazır liste; uygulamadan önce gözden geçir. Görsel yolları korunur.',
    ...lines
  ].join('\n')
}
