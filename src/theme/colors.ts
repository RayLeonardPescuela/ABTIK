/**
 * ABTIK visual system — modern dark-blue / navy tech palette.
 * Deep midnight-navy canvas, electric cobalt accents, crisp white titles
 * and muted cool-gray secondary text across landing, dashboards and maps.
 */
export const colors = {
  bg: '#0B132B',
  bgElevated: '#0F172A',
  bgPanel: '#172A45',
  border: '#2A4066',
  text: '#FFFFFF',
  textMuted: '#94A3B8',
  textDim: '#64748B',
  accent: '#3B82F6',
  accentSoft: 'rgba(59, 130, 246, 0.16)',
  success: '#2ECC8A',
  successSoft: 'rgba(46, 204, 138, 0.12)',
  successBorder: 'rgba(46, 204, 138, 0.45)',
  warning: '#F59E0B',
  danger: '#FF4D6D',
  dangerSoft: 'rgba(255, 77, 109, 0.18)',
  info: '#60A5FA',
  live: '#00E5A8',
  mapRoad: '#1E293B',
  accentBorder: 'rgba(59, 130, 246, 0.45)',
  borderSoft: 'rgba(42, 64, 102, 0.35)',
  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(11, 19, 43, 0.72)',
} as const;

export type ColorToken = keyof typeof colors;
