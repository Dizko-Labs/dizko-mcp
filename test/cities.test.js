import assert from "node:assert/strict";
import test from "node:test";
import {
  CITY_TABLE,
  cityDisplayName,
  cityTimezone,
  nearestCoveredCity,
  resolveCity,
  upstreamCityValue
} from "../src/cities.js";

test("resolveCity handles qualifiers, aliases, accents and unknown places", () => {
  assert.equal(resolveCity("Berlin, Germany")?.slug, "berlin");
  assert.equal(resolveCity("NYC")?.slug, "new-york");
  assert.equal(resolveCity("São Paulo")?.slug, "sao-paulo");
  assert.equal(resolveCity("Los Angeles, CA")?.slug, "los-angeles");
  assert.equal(resolveCity("bkk")?.slug, "bangkok");
  assert.equal(resolveCity("Hamburg"), null);
  assert.equal(resolveCity(""), null);
  assert.equal(resolveCity(undefined), null);
});

test("upstreamCityValue sends the slug for known cities and stripped text otherwise", () => {
  assert.equal(upstreamCityValue("new-york"), "new-york");
  assert.equal(upstreamCityValue("New York City"), "new-york");
  assert.equal(upstreamCityValue("Hamburg, Germany"), "hamburg");
});

test("cityTimezone and cityDisplayName cover known and unknown cities", () => {
  assert.equal(cityTimezone("berlin"), "Europe/Berlin");
  assert.equal(cityDisplayName("berlin"), "Berlin");
  assert.equal(cityDisplayName("new-york"), "New York");
  assert.equal(cityTimezone("hamburg"), null);
  assert.equal(cityDisplayName("hamburg"), "Hamburg");
  assert.equal(cityDisplayName(""), null);
});

test("nearestCoveredCity picks the closest covered city within 700 km", () => {
  const hamburg = nearestCoveredCity("Hamburg", ["berlin", "london"]);
  assert.equal(hamburg.slug, "berlin");
  assert.ok(hamburg.distance_km >= 240 && hamburg.distance_km <= 270, `Hamburg-Berlin is ~255 km, got ${hamburg.distance_km}`);
  assert.equal(Number.isInteger(hamburg.distance_km), true);

  assert.equal(nearestCoveredCity("Manchester", ["berlin", "london"]).slug, "london");

  const everything = CITY_TABLE.map((city) => city.slug);
  assert.equal(nearestCoveredCity("Sydney", everything), null, "nothing covered within 700 km of Sydney");
  assert.equal(nearestCoveredCity("Atlantis", everything), null, "unknown places have no coordinates");
});

test("nearestCoveredCity only considers cities that are live-covered", () => {
  // Brussels is ~320 km from London and ~650 km from Berlin: both qualify,
  // so coverage alone decides.
  assert.equal(nearestCoveredCity("Brussels", ["berlin", "london"]).slug, "london");
  assert.equal(nearestCoveredCity("Brussels", ["berlin"]).slug, "berlin");
  assert.equal(nearestCoveredCity("Brussels", []), null);
  assert.equal(nearestCoveredCity("Hamburg", ["london"]), null, "London is 721 km from Hamburg, outside the 700 km default");
  assert.equal(nearestCoveredCity("Hamburg", ["london"], { maxKm: 800 }).slug, "london");
});

test("CITY_TABLE has 47 unique slugs with valid IANA timezones", () => {
  assert.equal(CITY_TABLE.length, 47);
  const slugs = new Set(CITY_TABLE.map((city) => city.slug));
  assert.equal(slugs.size, CITY_TABLE.length);
  for (const city of CITY_TABLE) {
    assert.match(city.slug, /^[a-z]+(-[a-z]+)*$/, `${city.slug} is a slug`);
    assert.ok(city.name && city.country, `${city.slug} has a name and country`);
    assert.ok(Number.isFinite(city.lat) && Number.isFinite(city.lng), `${city.slug} has coordinates`);
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: city.timezone }), `${city.slug}: ${city.timezone}`);
  }
});
