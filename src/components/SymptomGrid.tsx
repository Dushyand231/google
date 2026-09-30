/**
 * Symptom quick-pick grid.
 *
 * Why tapping exists alongside voice: a health worker looking at a child with
 * a rash does not need to describe it correctly in Telugu to record it. Voice is
 * the fast path for what gets *said*; tapping is the reliable path for what is
 * *seen*. Neither replaces the other, and a tapped symptom produces the same
 * artefact as a spoken one so the clinical record cannot tell which was used --
 * except for the source field, which is kept honest for audit.
 *
 * Deliberately plain Pressables rather than an icon library: the pictograms are
 * emoji, which render on every Android device without shipping a font, and the
 * whole point is that this screen works on a cheap handset.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, space, TAP_MIN, type } from './theme';
import type { SymptomCode } from '../lib/parse';

export interface SymptomChip {
  code: SymptomCode;
  emoji: string;
  /** i18n key; the same keys the voice lexicon resolves through. */
  labelKey: string;
}

/** Pictogram keys mirror parse.ts SYMPTOM_LEXICON so icons stay consistent. */
export const SYMPTOM_ICON: Record<SymptomCode, string> = {
  fever: 'fever',
  cough: 'cough',
  vomiting: 'vomiting',
  diarrhea: 'diarrhea',
  headache: 'headache',
  bodyAche: 'bodyAche',
  chills: 'chills',
  breathlessness: 'breathlessness',
};

export const SYMPTOMS: SymptomChip[] = [
  { code: 'fever', emoji: '\u{1F912}', labelKey: 'fever' },
  { code: 'cough', emoji: '\u{1F443}', labelKey: 'cough' },
  { code: 'vomiting', emoji: '\u{1F92E}', labelKey: 'vomiting' },
  { code: 'diarrhea', emoji: '\u{1F4A9}', labelKey: 'diarrhea' },
  { code: 'headache', emoji: '\u{1F475}', labelKey: 'headache' },
  { code: 'bodyAche', emoji: '\u{1F9D0}', labelKey: 'bodyAche' },
  { code: 'chills', emoji: '\u{2744}\u{FE0F}', labelKey: 'chills' },
  { code: 'breathlessness', emoji: '\u{1F62C}', labelKey: 'breathlessness' },
];

export function SymptomGrid({
  selected,
  onToggle,
  labelOf,
  testIDPrefix = 'symptom',
}: {
  selected: readonly SymptomCode[];
  onToggle: (code: SymptomCode) => void;
  labelOf: (key: string) => string;
  testIDPrefix?: string;
}) {
  return (
    <View style={styles.grid}>
      {SYMPTOMS.map((s) => {
        const active = selected.includes(s.code);
        return (
          <Pressable
            key={s.code}
            testID={`${testIDPrefix}-${s.code}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            accessibilityLabel={labelOf(s.labelKey)}
            onPress={() => onToggle(s.code)}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipOn,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={styles.emoji} accessible={false}>
              {s.emoji}
            </Text>
            <Text numberOfLines={1} style={[styles.label, active && styles.labelOn]}>
              {labelOf(s.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  chip: {
    // Two columns on a narrow handset: wide enough for a 40px pictogram plus a
    // word, and still a 56px tap target.
    width: '48%',
    minHeight: TAP_MIN,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    paddingHorizontal: space(1.25),
    paddingVertical: space(1),
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  emoji: { fontSize: 26 },
  label: { flexShrink: 1, color: colors.text, ...type.label },
  labelOn: { color: colors.primary, fontWeight: '700' },
});
