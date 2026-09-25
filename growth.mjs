const METRICS = {
  weight: { key: 'weight_kg', unit: 'kg', label: '体重' },
  length: { key: 'length_cm', unit: 'cm', label: '卧位身长' },
  head: { key: 'head_cm', unit: 'cm', label: '头围' }
};

export const metricDefinitions = () => METRICS;

export const ageDaysShanghai = (birthDate, iso) => {
  const birth = Date.parse(`${birthDate}T00:00:00+08:00`);
  const measured = Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(iso))}T00:00:00+08:00`);
  return Number.isFinite(birth) && Number.isFinite(measured) ? Math.round((measured - birth) / 86400000) : NaN;
};

export const findLms = (reference, gender, metric, day) => {
  const sex = gender === '男' ? 'boys' : gender === '女' ? 'girls' : '';
  if (!sex || !Number.isInteger(day) || day < 0 || day > 730) return null;
  const row = reference?.tables?.[metric]?.[sex]?.[day];
  if (!Array.isArray(row) || row[0] !== day) return null;
  const [, L, M, S] = row;
  return [L, M, S].every(Number.isFinite) && M > 0 && S > 0 ? { L, M, S } : null;
};

export const zScore = (value, lms) => {
  if (!Number.isFinite(value) || !lms) return null;
  const { L, M, S } = lms;
  return Math.abs(L) < 1e-12 ? Math.log(value / M) / S : (Math.pow(value / M, L) - 1) / (L * S);
};

// Abramowitz-Stegun approximation is sufficient for display-level percentiles.
export const normalCdf = (z) => {
  if (!Number.isFinite(z)) return null;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
};

export const percentileText = (z) => {
  const p = normalCdf(z);
  if (!Number.isFinite(p)) return null;
  const percent = p * 100;
  if (percent < 0.1) return '<P0.1';
  if (percent > 99.9) return '>P99.9';
  return `P${percent.toFixed(1)}`;
};

export const scoreMeasurement = (reference, gender, metric, value, day) => {
  const lms = findLms(reference, gender, metric, day);
  if (!lms) return { z: null, percentile: null, available: false };
  const z = zScore(Number(value), lms);
  return { z: Number.isFinite(z) ? Number(z.toFixed(3)) : null, percentile: percentileText(z), available: Number.isFinite(z) };
};

export const scoreGrowthEvent = (reference, profile, event) => {
  const day = ageDaysShanghai(profile.birth_date, event.start_at);
  const scores = {};
  for (const [metric, info] of Object.entries(METRICS)) {
    if (event.details?.[info.key] !== undefined && event.details?.[info.key] !== '') scores[metric] = scoreMeasurement(reference, profile.gender, metric, Number(event.details[info.key]), day);
  }
  return { age_days: Number.isInteger(day) ? day : null, scores };
};

export const referenceSource = (reference) => reference?.source || reference?.sources || { title: 'WHO Child Growth Standards', url: 'https://www.who.int/tools/child-growth-standards/standards' };
