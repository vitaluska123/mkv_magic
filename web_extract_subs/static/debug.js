// debug.js — универсальный логгер для фронтенда
export const debugMode = true;
export function debugLog(...args) {
  if (debugMode) console.log('[debug]', ...args);
}
