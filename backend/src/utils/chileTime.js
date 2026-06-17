const CHILE_TZ = 'America/Santiago';

// Returns how many minutes `timeZone`'s wall clock is behind UTC at `date`
// (e.g. 240 for Chile's UTC-4 winter offset, 180 for UTC-3 summer/DST).
function getTzOffsetMinutes(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (date.getTime() - asUTC) / 60000;
}

// Converts Y/M/D HH:mm:ss components understood as America/Santiago local
// time into the equivalent real UTC Date, accounting for DST transitions.
function chileNaiveToUTC(year, month, day, hour = 0, minute = 0, second = 0) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offsetMinutes = getTzOffsetMinutes(CHILE_TZ, guess);
  return new Date(guess.getTime() + offsetMinutes * 60000);
}

// Same, but from a "YYYY-MM-DDTHH:mm:ss" string with no timezone designator.
function chileNaiveStringToUTC(raw) {
  const [datePart, timePart = '00:00:00'] = raw.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  return chileNaiveToUTC(year, month, day, hour, minute, second || 0);
}

// Returns the {year, month, day} of `date` as seen in Chile's local calendar.
function chileDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHILE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

module.exports = { chileNaiveToUTC, chileNaiveStringToUTC, chileDateParts };
