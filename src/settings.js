// Keep this key and parameter names stable across builds and layout changes.
export const SETTINGS_KEY = 'surface-depth-demo.settings';

function read(storage) {
  const value = JSON.parse(storage.getItem(SETTINGS_KEY) || '{}');
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function loadSettings(defaults, ranges, getStorage = () => globalThis.localStorage) {
  const values = { ...defaults };
  try {
    const saved = read(getStorage());
    for (const [key, fallback] of Object.entries(defaults)) {
      const value = saved[key];
      if (typeof fallback === 'number' && typeof value === 'number' && Number.isFinite(value)) {
        const { min, max, step } = ranges[key];
        const bounded = Math.min(max, Math.max(min, value));
        values[key] = Math.min(max, Math.max(min, Number((min + Math.round((bounded-min)/step)*step).toFixed(6))));
      } else if (typeof fallback === 'boolean' && typeof value === 'boolean') {
        values[key] = value;
      } else if (key === 'baseColor' && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
        values[key] = value;
      }
    }
  } catch { /* Missing or unavailable storage must not prevent rendering. */ }
  return values;
}

export function saveSettings(values, replace = false, getStorage = () => globalThis.localStorage) {
  try {
    const storage = getStorage();
    let previous = {};
    if (!replace) {
      try { previous = read(storage); } catch { /* Replace a damaged record. */ }
    }
    // Retain temporarily unused fields so an older build does not erase newer settings.
    storage.setItem(SETTINGS_KEY, JSON.stringify({ ...previous, ...values }));
    return true;
  } catch {
    return false;
  }
}
