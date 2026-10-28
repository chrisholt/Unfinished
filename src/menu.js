// Happy-hour schedules and menus.
//
// No public dataset publishes happy-hour menus and prices, so for venues
// without information this module produces a typical estimate: a schedule
// and menu shaped by the venue type and its OpenStreetMap tags, priced for
// the local currency. Estimates are deterministic per venue (seeded by its
// id) so a venue always shows the same numbers, and the UI labels them
// clearly as estimates that users can correct.

// Local-currency price level relative to US bar prices.
const PRICE_LEVELS = {
  us: ["USD", 1], ca: ["CAD", 1.35], mx: ["MXN", 14], br: ["BRL", 4],
  gb: ["GBP", 0.85], ie: ["EUR", 0.95], fr: ["EUR", 0.95], de: ["EUR", 0.75],
  nl: ["EUR", 0.9], be: ["EUR", 0.8], es: ["EUR", 0.6], pt: ["EUR", 0.5],
  it: ["EUR", 0.75], at: ["EUR", 0.8], fi: ["EUR", 1.05], gr: ["EUR", 0.65],
  ch: ["CHF", 1.1], se: ["SEK", 10], no: ["NOK", 13], dk: ["DKK", 8],
  pl: ["PLN", 2.4], cz: ["CZK", 13], hu: ["HUF", 220], au: ["AUD", 1.6],
  nz: ["NZD", 1.6], jp: ["JPY", 120], kr: ["KRW", 1100], sg: ["SGD", 1.6],
  hk: ["HKD", 9], in: ["INR", 45], th: ["THB", 30], ph: ["PHP", 35],
  ae: ["AED", 4.5], za: ["ZAR", 12],
};

export function currencyFor(countryCode) {
  const [code, level] = PRICE_LEVELS[countryCode?.toLowerCase()] || PRICE_LEVELS.us;
  return { code, level };
}

export function formatPrice(value, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.code }).format(value);
  } catch {
    return `${currency.code} ${value.toFixed(2)}`;
  }
}

function roundPrice(v) {
  const step = v < 20 ? 0.5 : v < 100 ? 1 : v < 1000 ? 10 : 50;
  return Math.max(step, Math.round(v / step) * step);
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRandom(seed) {
  let a = typeof seed === "string" ? hash(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// Base prices are typical US bar prices; `kinds` lists venue kinds that
// usually serve the item.
const CATALOG = {
  drinks: [
    { name: "Pint of house lager", base: 7, kinds: ["pub", "bar", "nightclub"], core: true },
    { name: "Pint of IPA", base: 8, kinds: ["pub", "bar"] },
    { name: "Pint of stout", base: 8, kinds: ["pub"] },
    { name: "Pint of cider", base: 7.5, kinds: ["pub", "bar"] },
    { name: "Half-litre Helles", base: 7, kinds: ["biergarten"], core: true },
    { name: "Litre of Helles (Maß)", base: 13, kinds: ["biergarten"] },
    { name: "Radler", base: 6.5, kinds: ["biergarten", "pub"] },
    { name: "Bottled beer", base: 6, kinds: ["bar", "nightclub", "restaurant", "cafe"], core: true },
    { name: "House wine (175 ml)", base: 9, kinds: ["pub", "bar", "restaurant", "cafe", "biergarten"] },
    { name: "Prosecco (glass)", base: 10, kinds: ["bar", "restaurant", "nightclub"] },
    { name: "Well spirit & mixer", base: 8, kinds: ["pub", "bar", "nightclub"] },
    { name: "Margarita", base: 13, kinds: ["bar", "restaurant", "nightclub"], cocktail: true },
    { name: "Espresso martini", base: 14, kinds: ["bar", "nightclub"], cocktail: true },
    { name: "Aperol spritz", base: 12, kinds: ["bar", "restaurant", "cafe"], cocktail: true },
    { name: "Mojito", base: 13, kinds: ["bar", "nightclub"], cocktail: true },
    { name: "Old fashioned", base: 14, kinds: ["bar"], cocktail: true },
    { name: "Shot of the day", base: 6, kinds: ["nightclub", "bar"] },
  ],
  food: [
    { name: "Chicken wings (6)", base: 12, kinds: ["pub", "bar"] },
    { name: "Loaded fries", base: 9, kinds: ["pub", "bar"] },
    { name: "Nachos to share", base: 13, kinds: ["pub", "bar", "restaurant"] },
    { name: "Mini sliders (3)", base: 13, kinds: ["pub", "bar", "restaurant"] },
    { name: "Scotch egg", base: 7, kinds: ["pub"] },
    { name: "Bowl of chips", base: 6, kinds: ["pub"] },
    { name: "Soft pretzel & obatzda", base: 8, kinds: ["biergarten"] },
    { name: "Bratwurst & mustard", base: 10, kinds: ["biergarten"] },
    { name: "Olives & bread", base: 7, kinds: ["bar", "restaurant", "cafe"] },
    { name: "Bruschetta", base: 9, kinds: ["restaurant", "cafe", "bar"] },
    { name: "Calamari", base: 12, kinds: ["restaurant", "bar"] },
    { name: "Cheese board", base: 16, kinds: ["bar", "restaurant"] },
  ],
};

function venueKind(venue) {
  return venue.kind in { pub: 1, bar: 1, biergarten: 1, nightclub: 1, restaurant: 1, cafe: 1 } ? venue.kind : "bar";
}

const splitTag = (v) => (v ? v.split(";").map((s) => s.trim()).filter(Boolean) : []);

// Estimated schedule in opening_hours syntax.
export function estimateSchedule(venue) {
  const rand = seededRandom(`hh:${venue.id}`);
  switch (venueKind(venue)) {
    case "pub":
      return pick(rand, ["Mo-Fr 16:00-19:00", "Mo-Fr 17:00-19:00", "Mo-Fr 16:00-18:00; Su 15:00-18:00", "Mo-Th 16:00-19:00; Fr 15:00-18:00"]);
    case "biergarten":
      return pick(rand, ["Mo-Fr 15:00-17:00", "Mo-Su 15:00-17:00"]);
    case "nightclub":
      return pick(rand, ["Th-Sa 22:00-00:00", "Fr,Sa 21:00-23:00"]);
    case "restaurant":
    case "cafe":
      return pick(rand, ["Mo-Fr 15:00-18:00", "Mo-Fr 16:00-18:00"]);
    default:
      return pick(rand, ["Mo-Fr 17:00-19:00", "Mo-Fr 16:00-19:00", "Mo-Fr 17:00-19:00; Th-Sa 22:00-00:00", "Mo-Su 16:00-18:00"]);
  }
}

// Menu: [{ section, items: [{ name, regular, happy }] }] in local currency.
export function estimateMenu(venue, currency) {
  const rand = seededRandom(`menu:${venue.id}`);
  const kind = venueKind(venue);
  const tags = venue.tags || {};
  const venueLevel = 0.85 + rand() * 0.3; // some places are pricier than others
  const price = (base) => roundPrice(base * currency.level * venueLevel);
  const discount = () => 0.6 + Math.floor(rand() * 4) * 0.05; // 25–40% off

  const drinks = [];
  for (const brand of splitTag(tags.brewery).slice(0, 2)) {
    drinks.push({ name: `Pint of ${brand}`, base: 7.5 });
  }
  if (tags.real_ale === "yes") drinks.push({ name: "Cask real ale (pint)", base: 7 });
  const cocktails = tags.cocktails === "yes" || /cocktail/i.test(tags.bar || "") || kind === "nightclub";
  const pool = CATALOG.drinks.filter((d) => d.kinds.includes(kind) && (!d.cocktail || cocktails || rand() < 0.4));
  for (const d of pool) {
    if (drinks.length >= 6) break;
    if (d.core || rand() < 0.6) drinks.push(d);
  }

  const food = [];
  if (kind !== "nightclub" && tags.food !== "no") {
    for (const f of CATALOG.food.filter((x) => x.kinds.includes(kind))) {
      if (food.length < 4 && rand() < 0.65) food.push(f);
    }
  }

  const priced = (items) =>
    items.map((i) => {
      const regular = price(i.base);
      return { name: i.name, regular, happy: Math.min(regular, roundPrice(regular * discount())) };
    });

  return [
    { section: "Drinks", items: priced(drinks) },
    ...(food.length ? [{ section: "Bar snacks", items: priced(food) }] : []),
  ];
}

// Cheapest happy-hour drink, used for sorting and the crawl budget.
export function cheapestDrink(menu) {
  const drinks = menu.find((s) => s.section === "Drinks")?.items || [];
  return drinks.reduce((best, i) => (!best || i.happy < best.happy ? i : best), null);
}

// Plain-text menu format used by the editor: "Name | regular | happy".
export function menuToText(menu) {
  return menu
    .map((s) => [`# ${s.section}`, ...s.items.map((i) => `${i.name} | ${i.regular} | ${i.happy}`)].join("\n"))
    .join("\n\n");
}

export function textToMenu(text) {
  const menu = [];
  let section = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      section = { section: line.replace(/^#+\s*/, "") || "Menu", items: [] };
      menu.push(section);
      continue;
    }
    const [name, reg, hap] = line.split("|").map((s) => s.trim());
    const regular = Number(reg);
    const happy = hap === undefined || hap === "" ? regular : Number(hap);
    if (!name || !Number.isFinite(regular) || !Number.isFinite(happy)) continue;
    if (!section) {
      section = { section: "Drinks", items: [] };
      menu.push(section);
    }
    section.items.push({ name, regular, happy });
  }
  return menu.filter((s) => s.items.length);
}
