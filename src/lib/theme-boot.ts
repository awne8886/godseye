/**
 * Pre-paint theme restore: an inline <head> script sets `data-theme` on <html> from `?theme=` or
 * the Style Studio's saved preset before first paint, so a non-HORUS theme never flashes HORUS.
 * design-system-hud writes THEME_STORAGE_KEY when a preset is chosen. Owner: lead.
 */
export const THEME_STORAGE_KEY = 'godseye:theme';

/** Same rule as url-state's theme param: 2–24 of [A-Z0-9_-], upper-cased. */
export const THEME_ID_RE = /^[A-Z0-9_-]{2,24}$/i;

/** Plain ES5 so it runs before any bundle; never throws (storage may be blocked). */
export const THEME_BOOT_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get('theme');var t=q;if(!t){try{t=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}}if(t&&${THEME_ID_RE.toString()}.test(t)){t=t.toUpperCase();if(t!=='HORUS')document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();`;
