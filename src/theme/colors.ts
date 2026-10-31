/**
 * ABTIK visual system — night-first provincial mobility.
 * Deep navy canvas, amber safety accents, high-contrast map chrome.
 */
export const colors = {
  bg: '#0B1220',
  bgElevated: '#121A2B',
  bgPanel: '#162033',
  border: '#243049',
  text: '#F4F7FB',
  textMuted: '#9AA8C0',
  textDim: '#6B7A94',
  accent: '#F5A524',
  accentSoft: 'rgba(245, 165, 36, 0.16)',
  success: '#2ECC8A',
  danger: '#FF4D6D',
  dangerSoft: 'rgba(255, 77, 109, 0.18)',
  info: '#4DA3FF',
  live: '#00E5A8',
  mapRoad: '#1C2740',
  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(11, 18, 32, 0.72)',
} as const;

export type ColorToken = keyof typeof colors;
