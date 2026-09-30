/**
 * Visual tokens.
 *
 * Contrast ratios against the surfaces below are all at or above 4.5:1, which
 * matters more here than in a typical app: the primary user is reading a phone
 * screen outdoors, often older, often in direct sun. Large tap targets follow
 * the same reasoning -- a health worker may be holding a BP cuff in one hand.
 */

export const colors = {
  bg: '#F4F6F5',
  surface: '#FFFFFF',
  surfaceAlt: '#E8EFED',
  border: '#C3D2CE',
  text: '#0B1F1C',
  textMuted: '#4A5F5B',
  primary: '#0B4F4A',
  primaryText: '#FFFFFF',
  accent: '#B3541E',
  danger: '#8C1D18',
  dangerBg: '#FBE9E7',
  warn: '#8A5A00',
  warnBg: '#FDF3E0',
  ok: '#1B5E20',
  okBg: '#E7F2E8',
} as const;

export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;

export const space = (n: number) => n * 8;

export const type = {
  display: { fontSize: 30, lineHeight: 38, fontWeight: '700' as const },
  title: { fontSize: 22, lineHeight: 30, fontWeight: '700' as const },
  body: { fontSize: 18, lineHeight: 27, fontWeight: '500' as const },
  label: { fontSize: 15, lineHeight: 21, fontWeight: '600' as const },
} as const;

/** Minimum height for anything a health worker taps in a hurry. */
export const TAP_MIN = 56;
