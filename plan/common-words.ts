// HK-7 (Q-GD2-4): client names that are ordinary words. A client called "Atlas" or "Summit" would hold back every message
// that uses the word ("the summit is Tuesday"), so for such a client the boundary matches only as written: the exact
// casing of its name or alias ("Atlas" matches, "atlas" doesn't). The default rule is simple on purpose: on when one of
// the client's names is a single word in this list, off otherwise; an admin can turn it on or off per client
// (Admin › Clients, "Match only as written"). The list is words that are common in work chat and common as company
// names; it never holds a client's name, only English words.

/** Ordinary English words, lowercase. */
export const ORDINARY_WORDS: ReadonlySet<string> = new Set(
  `able access acme active advance agile alliance allied alpha amber anchor apex apollo arch arrow ascent aspen aspire
  atlas aurora avenue axis balance banner baseline bay beacon bedrock benchmark birch blue bluebird bold bolt bridge
  bright brook build cadence canopy canyon capital cardinal cascade catalyst cedar centric central centre center
  champion charter circle citadel civic clarity clear cloud coast cobalt compass concord connect constant copper coral
  core cornerstone crest crown crystal current cypress dash data dawn delta design direct discovery dynamic eagle
  east echo edge element elevate ember emerald empire endeavor engage envision epic equinox essential evergreen evolve
  excel express falcon field first flagship fleet focus forge forward foundation freedom frontier fusion galaxy
  garden gateway general genesis glacier global gold granite graphite green grove guardian guide harbor harbour harmony
  harvest haven hawk heritage highland horizon hub ignite impact independent infinity insight inspire integrity iron
  island ivy jade journey jupiter keystone kinetic lake landmark launch legacy liberty lighthouse lime link lotus
  magnet main majestic maple marathon mariner matrix meadow mercury meridian mesa metro midwest milestone
  mission momentum monarch mosaic motion mountain national native navigator nexus noble north northern nova oak
  oasis ocean olympus omega onyx open optimum orbit orchard origin pacific paragon paramount park patriot peak pearl
  pilot pine pinnacle pioneer pivot planet platinum plaza point polaris portal premier prestige prime progress
  prospect pulse quantum quest radiant rain rainier range ranger rapid redwood regal reliance ridge rise river rock
  rocket royal ruby sage sapphire scout sentinel sequoia shift shore sierra signal silver simple sky slate solar
  solid sonic south southern spark spectrum spire spring spruce square standard star sterling stone storm strategic
  stream summit sun sunrise superior swift synergy target terra thrive tide timber titan torch tower trail
  triangle trident trinity triumph true trust union unity universal uplift valley vanguard vector venture vertex
  vertical vista vital voyager wave west western willow wind wing wisdom zenith zephyr`.split(/\s+/).filter(Boolean),
);

/** One word of letters only (no space, digit or other mark), in the list without case. */
export const isOrdinaryWord = (name: string): boolean => /^\p{L}+$/u.test(name.trim()) && ORDINARY_WORDS.has(name.trim().toLowerCase());

/** The default for "Match only as written": on when any of the client's names (key, Dataverse names) is an ordinary word. */
export const exactCaseDefault = (names: readonly string[]): boolean => names.some(isOrdinaryWord);
