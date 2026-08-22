/* ---------- Ethiopian calendar ----------
   Exact conversion, not an approximation: the Ethiopian calendar has
   12 months of exactly 30 days + a 13th month (ጳጉሜ) of 5 or 6 days, so
   simple day-offset arithmetic from New Year's Day is mathematically
   correct — the only real-world fact needed is which Gregorian day
   New Year falls on for a given Ethiopian year, which is documented:
   11 September, or 12 September in the year before a Gregorian leap year.
*/

function isGregorianLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// Meskerem 1 (Ethiopian New Year) of `ethYear`, as a Gregorian Date.
function ethiopianNewYearGregorian(ethYear) {
  const gregYear = ethYear + 7;
  const day = isGregorianLeap(gregYear + 1) ? 12 : 11;
  return new Date(gregYear, 8, day); // month 8 = September (0-indexed)
}

function ethiopianToGregorian(ethYear, ethMonth, ethDay) {
  const newYear = ethiopianNewYearGregorian(ethYear);
  const daysSinceNewYear = (ethMonth - 1) * 30 + (ethDay - 1);
  const result = new Date(newYear);
  result.setDate(result.getDate() + daysSinceNewYear);
  return result;
}

function gregorianToEthiopian(gDate) {
  // normalize to local midnight first so the day-count is exact regardless
  // of what time of day `gDate` carries (otherwise afternoon timestamps
  // could round up into the wrong Ethiopian day).
  const normalized = new Date(gDate.getFullYear(), gDate.getMonth(), gDate.getDate());
  const gYear = normalized.getFullYear();
  const candidateEthYear = gYear - 7;
  const ny = ethiopianNewYearGregorian(candidateEthYear);
  let ethYear, newYear;
  if (normalized >= ny) {
    ethYear = candidateEthYear;
    newYear = ny;
  } else {
    ethYear = candidateEthYear - 1;
    newYear = ethiopianNewYearGregorian(ethYear);
  }
  const diffDays = Math.round((normalized - newYear) / 86400000);
  const month = Math.floor(diffDays / 30) + 1;
  const day = (diffDays % 30) + 1;
  return { year: ethYear, month, day };
}

const ETH_MONTH_NAMES_AM = ["", "መስከረም", "ጥቅምት", "ህዳር", "ታህሳስ", "ጥር", "የካቲት", "መጋቢት", "ሚያዝያ", "ግንቦት", "ሰኔ", "ሐምሌ", "ነሐሴ", "ጳጉሜ"];
const ETH_MONTH_NAMES_EN = ["", "Meskerem", "Tikimt", "Hidar", "Tahsas", "Tir", "Yekatit", "Megabit", "Miazia", "Ginbot", "Sene", "Hamle", "Nehase", "Pagume"];

// Recognized spelling variants (and the "ክረምት"/kiremt season, mapped to
// its start month) → Ethiopian month number, used to read due dates
// straight out of the plan's own timing text.
const ETH_MONTH_MAP = {
  "መስከረም": 1, "ጥቅምት": 2, "ህዳር": 3, "ኅዳር": 3, "ታህሳስ": 4, "ታኅሳስ": 4, "ጥር": 5,
  "የካቲት": 6, "መጋቢት": 7, "ሚያዝያ": 8, "ግንቦት": 9, "ሰኔ": 10, "ሐምሌ": 11, "ሓምሌ": 11,
  "ነሐሴ": 12, "ጳጉሜ": 13, "ጳጉሜን": 13, "ክረምት": 10,
};

function parseEthiopianMonthsFromText(text) {
  if (!text) return [];
  const found = new Set();
  for (const key of Object.keys(ETH_MONTH_MAP)) {
    if (text.includes(key)) found.add(ETH_MONTH_MAP[key]);
  }
  return [...found].sort((a, b) => a - b);
}

// The next occurrence (strictly after `fromDate`) of any of the given
// Ethiopian month numbers, as day 1 of that month — wraps into next
// Ethiopian year automatically once this year's mentions have passed.
function nextEthiopianCheckpoint(monthNumbers, fromDate) {
  if (!monthNumbers || !monthNumbers.length) return null;
  const fromEth = gregorianToEthiopian(fromDate);
  const fromMidnight = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const candidates = [];
  for (const y of [fromEth.year, fromEth.year + 1]) {
    for (const m of monthNumbers) candidates.push(ethiopianToGregorian(y, m, 1));
  }
  candidates.sort((a, b) => a - b);
  for (const c of candidates) if (c > fromMidnight) return c;
  return candidates[candidates.length - 1] || null;
}

// Convenience used throughout app.js: given plan-item timing text and a
// reference date, return the next due date as an ISO string, or null if
// the text doesn't name a specific Ethiopian month (e.g. "እንደአስፈላጊነቱ") —
// callers fall back to the generic recurrence-days heuristic in that case.
function computeEthAwareNextDate(timingText, fromDate) {
  const months = parseEthiopianMonthsFromText(timingText);
  if (!months.length) return null;
  const d = nextEthiopianCheckpoint(months, fromDate);
  return d ? isoDate(d) : null;
}

// Human-readable Ethiopian date for a Gregorian ISO string ("YYYY-MM-DD"),
// in whichever language is currently active.
function ethLabel(isoDateStr) {
  if (!isoDateStr) return "";
  const d = new Date(isoDateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  const e = gregorianToEthiopian(d);
  const names = getLang() === "am" ? ETH_MONTH_NAMES_AM : ETH_MONTH_NAMES_EN;
  return `${e.day} ${names[e.month]} ${e.year}`;
}
