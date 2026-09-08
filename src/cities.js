// Static city knowledge the upstream API does not send with events: IANA
// timezone (events arrive as UTC and must be shown in city-local time),
// display name (venue_city is a lowercase slug), and coordinates (used to
// compute the nearest covered city for an unsupported request). Coverage
// status is NOT here - that is live data from /cities.

export const CITY_TABLE = [
  ["amsterdam", "Amsterdam", "Netherlands", "Europe/Amsterdam", 52.3676, 4.9041],
  ["atlanta", "Atlanta", "United States", "America/New_York", 33.749, -84.388],
  ["athens", "Athens", "Greece", "Europe/Athens", 37.9838, 23.7275],
  ["austin", "Austin", "United States", "America/Chicago", 30.2672, -97.7431],
  ["bangkok", "Bangkok", "Thailand", "Asia/Bangkok", 13.7563, 100.5018],
  ["barcelona", "Barcelona", "Spain", "Europe/Madrid", 41.3874, 2.1686],
  ["berlin", "Berlin", "Germany", "Europe/Berlin", 52.52, 13.405],
  ["bogota", "Bogotá", "Colombia", "America/Bogota", 4.711, -74.0721],
  ["budapest", "Budapest", "Hungary", "Europe/Budapest", 47.4979, 19.0402],
  ["buenos-aires", "Buenos Aires", "Argentina", "America/Argentina/Buenos_Aires", -34.6037, -58.3816],
  ["calgary", "Calgary", "Canada", "America/Edmonton", 51.0447, -114.0719],
  ["chicago", "Chicago", "United States", "America/Chicago", 41.8781, -87.6298],
  ["copenhagen", "Copenhagen", "Denmark", "Europe/Copenhagen", 55.6761, 12.5683],
  ["denver", "Denver", "United States", "America/Denver", 39.7392, -104.9903],
  ["detroit", "Detroit", "United States", "America/Detroit", 42.3314, -83.0458],
  ["dublin", "Dublin", "Ireland", "Europe/Dublin", 53.3498, -6.2603],
  ["dubai", "Dubai", "United Arab Emirates", "Asia/Dubai", 25.2048, 55.2708],
  ["hong-kong", "Hong Kong", "Hong Kong", "Asia/Hong_Kong", 22.3193, 114.1694],
  ["ibiza", "Ibiza", "Spain", "Europe/Madrid", 38.9067, 1.4206],
  ["istanbul", "Istanbul", "Türkiye", "Europe/Istanbul", 41.0082, 28.9784],
  ["lagos", "Lagos", "Nigeria", "Africa/Lagos", 6.5244, 3.3792],
  ["lisbon", "Lisbon", "Portugal", "Europe/Lisbon", 38.7223, -9.1393],
  ["london", "London", "United Kingdom", "Europe/London", 51.5074, -0.1278],
  ["los-angeles", "Los Angeles", "United States", "America/Los_Angeles", 34.0522, -118.2437],
  ["madrid", "Madrid", "Spain", "Europe/Madrid", 40.4168, -3.7038],
  ["medellin", "Medellín", "Colombia", "America/Bogota", 6.2442, -75.5812],
  ["mexico-city", "Mexico City", "Mexico", "America/Mexico_City", 19.4326, -99.1332],
  ["milan", "Milan", "Italy", "Europe/Rome", 45.4642, 9.19],
  ["miami", "Miami", "United States", "America/New_York", 25.7617, -80.1918],
  ["montreal", "Montreal", "Canada", "America/Toronto", 45.5017, -73.5673],
  ["nashville", "Nashville", "United States", "America/Chicago", 36.1627, -86.7816],
  ["new-york", "New York", "United States", "America/New_York", 40.7128, -74.006],
  ["new-orleans", "New Orleans", "United States", "America/Chicago", 29.9511, -90.0715],
  ["osaka", "Osaka", "Japan", "Asia/Tokyo", 34.6937, 135.5023],
  ["paris", "Paris", "France", "Europe/Paris", 48.8566, 2.3522],
  ["prague", "Prague", "Czechia", "Europe/Prague", 50.0755, 14.4378],
  ["rio-de-janeiro", "Rio de Janeiro", "Brazil", "America/Sao_Paulo", -22.9068, -43.1729],
  ["rome", "Rome", "Italy", "Europe/Rome", 41.9028, 12.4964],
  ["san-francisco", "San Francisco", "United States", "America/Los_Angeles", 37.7749, -122.4194],
  ["sao-paulo", "São Paulo", "Brazil", "America/Sao_Paulo", -23.5505, -46.6333],
  ["seoul", "Seoul", "South Korea", "Asia/Seoul", 37.5665, 126.978],
  ["singapore", "Singapore", "Singapore", "Asia/Singapore", 1.3521, 103.8198],
  ["stockholm", "Stockholm", "Sweden", "Europe/Stockholm", 59.3293, 18.0686],
  ["tokyo", "Tokyo", "Japan", "Asia/Tokyo", 35.6762, 139.6503],
  ["toronto", "Toronto", "Canada", "America/Toronto", 43.6532, -79.3832],
  ["vienna", "Vienna", "Austria", "Europe/Vienna", 48.2082, 16.3738],
  ["warsaw", "Warsaw", "Poland", "Europe/Warsaw", 52.2297, 21.0122]
].map(([slug, name, country, timezone, lat, lng]) => ({ slug, name, country, timezone, lat, lng }));

// Short forms and local spellings people actually type. Values are slugs.
const CITY_ALIASES = {
  nyc: "new-york", "new york city": "new-york", manhattan: "new-york", brooklyn: "new-york",
  la: "los-angeles", "l.a.": "los-angeles", sf: "san-francisco", "san fran": "san-francisco",
  cdmx: "mexico-city", "ciudad de mexico": "mexico-city", "ciudad de méxico": "mexico-city",
  bcn: "barcelona", hk: "hong-kong", "hong kong sar": "hong-kong", rio: "rio-de-janeiro",
  "são paulo": "sao-paulo", "sao paulo": "sao-paulo", "sp": "sao-paulo",
  "bogotá": "bogota", "medellín": "medellin", "montréal": "montreal", "wien": "vienna",
  "warszawa": "warsaw", "praha": "prague", "roma": "rome", "milano": "milan",
  "lisboa": "lisbon", "münchen": null, "köln": null, "eivissa": "ibiza",
  "istanbul": "istanbul", "i̇stanbul": "istanbul", "bkk": "bangkok", "yyc": "calgary",
  "nola": "new-orleans", "atl": "atlanta", "chi": "chicago", "mia": "miami"
};

// Places people ask about that Dizko does not cover, so the nearest covered
// city can be computed instead of guessed. Coordinates only.
const NEARBY_PLACES = {
  hamburg: [53.5511, 9.9937], munich: [48.1351, 11.582], "münchen": [48.1351, 11.582], cologne: [50.9375, 6.9603],
  "köln": [50.9375, 6.9603], frankfurt: [50.1109, 8.6821], leipzig: [51.3397, 12.3731], dresden: [51.0504, 13.7373],
  potsdam: [52.3906, 13.0645], stuttgart: [48.7758, 9.1829], dusseldorf: [51.2277, 6.7735], "düsseldorf": [51.2277, 6.7735],
  manchester: [53.4808, -2.2426], birmingham: [52.4862, -1.8904], bristol: [51.4545, -2.5879], leeds: [53.8008, -1.5491],
  glasgow: [55.8642, -4.2518], edinburgh: [55.9533, -3.1883], liverpool: [53.4084, -2.9916], brighton: [50.8225, -0.1372],
  cambridge: [52.2053, 0.1218], oxford: [51.752, -1.2577], cardiff: [51.4816, -3.1791], belfast: [54.5973, -5.9301],
  cork: [51.8985, -8.4756], lyon: [45.764, 4.8357], marseille: [43.2965, 5.3698], bordeaux: [44.8378, -0.5792],
  lille: [50.6292, 3.0573], toulouse: [43.6047, 1.4442], nantes: [47.2184, -1.5536], brussels: [50.8503, 4.3517],
  antwerp: [51.2194, 4.4025], ghent: [51.0543, 3.7174], rotterdam: [51.9244, 4.4777], utrecht: [52.0907, 5.1214],
  "the hague": [52.0705, 4.3007], eindhoven: [51.4416, 5.4697], zurich: [47.3769, 8.5417], "zürich": [47.3769, 8.5417],
  geneva: [46.2044, 6.1432], basel: [47.5596, 7.5886], oslo: [59.9139, 10.7522], helsinki: [60.1699, 24.9384],
  gothenburg: [57.7089, 11.9746], malmo: [55.605, 13.0038], "malmö": [55.605, 13.0038], aarhus: [56.1629, 10.2039],
  porto: [41.1579, -8.6291], seville: [37.3891, -5.9845], valencia: [39.4699, -0.3763], bilbao: [43.263, -2.935],
  malaga: [36.7213, -4.4214], mallorca: [39.5696, 2.6502], palma: [39.5696, 2.6502], naples: [40.8518, 14.2681],
  florence: [43.7696, 11.2558], turin: [45.0703, 7.6869], bologna: [44.4949, 11.3426], venice: [45.4408, 12.3155],
  krakow: [50.0647, 19.945], "kraków": [50.0647, 19.945], gdansk: [54.352, 18.6466], wroclaw: [51.1079, 17.0385],
  bratislava: [48.1486, 17.1077], zagreb: [45.815, 15.9819], belgrade: [44.7866, 20.4489], thessaloniki: [40.6401, 22.9444],
  tel_aviv: [32.0853, 34.7818], "tel aviv": [32.0853, 34.7818], "abu dhabi": [24.4539, 54.3773], doha: [25.2854, 51.531],
  philadelphia: [39.9526, -75.1652], boston: [42.3601, -71.0589], washington: [38.9072, -77.0369], "washington dc": [38.9072, -77.0369],
  baltimore: [39.2904, -76.6122], pittsburgh: [40.4406, -79.9959], cleveland: [41.4993, -81.6944], columbus: [39.9612, -82.9988],
  cincinnati: [39.1031, -84.512], indianapolis: [39.7684, -86.1581], milwaukee: [43.0389, -87.9065], minneapolis: [44.9778, -93.265],
  "st louis": [38.627, -90.1994], "kansas city": [39.0997, -94.5786], dallas: [32.7767, -96.797], houston: [29.7604, -95.3698],
  "san antonio": [29.4241, -98.4936], phoenix: [33.4484, -112.074], "las vegas": [36.1699, -115.1398], "salt lake city": [40.7608, -111.891],
  seattle: [47.6062, -122.3321], portland: [45.5152, -122.6784], "san diego": [32.7157, -117.1611], sacramento: [38.5816, -121.4944],
  oakland: [37.8044, -122.2712], "san jose": [37.3382, -121.8863], tampa: [27.9506, -82.4572], orlando: [28.5383, -81.3792],
  charlotte: [35.2271, -80.8431], raleigh: [35.7796, -78.6382], richmond: [37.5407, -77.436], memphis: [35.1495, -90.049],
  louisville: [38.2527, -85.7585], vancouver: [49.2827, -123.1207], ottawa: [45.4215, -75.6972], quebec: [46.8139, -71.208],
  "quebec city": [46.8139, -71.208], edmonton: [53.5461, -113.4938], winnipeg: [49.8951, -97.1384], guadalajara: [20.6597, -103.3496],
  monterrey: [25.6866, -100.3161], tijuana: [32.5149, -117.0382], cancun: [21.1619, -86.8515], "cancún": [21.1619, -86.8515],
  lima: [-12.0464, -77.0428], santiago: [-33.4489, -70.6693], montevideo: [-34.9011, -56.1645], cali: [3.4516, -76.532],
  "belo horizonte": [-19.9167, -43.9345], curitiba: [-25.4284, -49.2733], "porto alegre": [-30.0346, -51.2177], brasilia: [-15.8267, -47.9218],
  florianopolis: [-27.5954, -48.548], kyoto: [35.0116, 135.7681], nagoya: [35.1815, 136.9066], fukuoka: [33.5904, 130.4017],
  sapporo: [43.0618, 141.3545], busan: [35.1796, 129.0756], taipei: [25.033, 121.5654], shanghai: [31.2304, 121.4737],
  shenzhen: [22.5431, 114.0579], macau: [22.1987, 113.5439], manila: [14.5995, 120.9842], "kuala lumpur": [3.139, 101.6869],
  jakarta: [-6.2088, 106.8456], bali: [-8.4095, 115.1889], "chiang mai": [18.7883, 98.9853], phuket: [7.8804, 98.3923],
  "ho chi minh city": [10.8231, 106.6297], saigon: [10.8231, 106.6297], hanoi: [21.0278, 105.8342], accra: [5.6037, -0.187],
  abuja: [9.0765, 7.3986], ibadan: [7.3775, 3.947], johannesburg: [-26.2041, 28.0473], "cape town": [-33.9249, 18.4241],
  nairobi: [-1.2921, 36.8219], cairo: [30.0444, 31.2357], marrakech: [31.6295, -7.9811], casablanca: [33.5731, -7.5898],
  sydney: [-33.8688, 151.2093], melbourne: [-37.8136, 144.9631], auckland: [-36.8485, 174.7633]
};

const bySlug = new Map(CITY_TABLE.map((city) => [city.slug, city]));

export function normalizeCityKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Strips a trailing ", Country" / ", State" qualifier the model often adds.
export function stripCityQualifier(value) {
  const text = normalizeCityKey(value);
  const comma = text.indexOf(",");
  return comma > 0 ? text.slice(0, comma).trim() : text;
}

// Resolves free text to a known city record, or null when we do not know it.
export function resolveCity(value) {
  if (!value) return null;
  const raw = normalizeCityKey(value);
  const candidates = [raw, stripCityQualifier(raw)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const slug = candidate.replace(/ /g, "-");
    if (bySlug.has(slug)) return bySlug.get(slug);
    const alias = CITY_ALIASES[candidate];
    if (alias && bySlug.has(alias)) return bySlug.get(alias);
    const deaccented = candidate.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const deaccentedSlug = deaccented.replace(/ /g, "-");
    if (bySlug.has(deaccentedSlug)) return bySlug.get(deaccentedSlug);
  }
  return null;
}

// The value to send upstream: a known slug when we recognize the city,
// otherwise the qualifier-stripped text so upstream's own matching gets a
// fair chance ("nyc" and "la" are handled there too).
export function upstreamCityValue(value) {
  const known = resolveCity(value);
  if (known) return known.slug;
  return stripCityQualifier(value) || String(value || "").trim();
}

export function cityTimezone(value) {
  return resolveCity(value)?.timezone || null;
}

export function cityDisplayName(value) {
  const known = resolveCity(value);
  if (known) return known.name;
  const text = String(value || "").trim();
  if (!text) return null;
  return text.split(/[\s-]+/).map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRadians = (v) => v * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Coordinates for a requested place: a covered city or a known nearby place.
export function placeCoordinates(value) {
  const known = resolveCity(value);
  if (known) return { lat: known.lat, lng: known.lng };
  const key = stripCityQualifier(value);
  const nearby = NEARBY_PLACES[key] || NEARBY_PLACES[key.normalize("NFD").replace(/[̀-ͯ]/g, "")];
  return nearby ? { lat: nearby[0], lng: nearby[1] } : null;
}

// Nearest city among `coveredSlugs` (live data) within maxKm, or null.
export function nearestCoveredCity(requested, coveredSlugs, { maxKm = 700 } = {}) {
  const origin = placeCoordinates(requested);
  if (!origin) return null;
  const covered = new Set(coveredSlugs);
  let best = null;
  for (const city of CITY_TABLE) {
    if (!covered.has(city.slug)) continue;
    const km = haversineKm(origin.lat, origin.lng, city.lat, city.lng);
    if (km <= maxKm && (!best || km < best.distance_km)) best = { ...city, distance_km: Math.round(km) };
  }
  return best;
}
