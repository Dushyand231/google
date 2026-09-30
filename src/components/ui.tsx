import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ReactNode } from 'react';

import { colors, radius, space, TAP_MIN, type } from './theme';

export type FieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'numeric' | 'url';
  testID?: string;
};

/**
 * Text input with the label above it rather than a floating label, and the
 * error underneath. Kept in the same file as the other primitives so a form
 * cannot drift from the tap targets and contrast used everywhere else.
 */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry,
  autoCapitalize = 'none',
  keyboardType = 'default',
  testID,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        accessibilityLabel={label}
        style={[styles.input, !!error && styles.inputError]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: colors.textMuted }]}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  testID?: string;
};

export function Button({ title, onPress, variant = 'primary', disabled, testID }: ButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === 'secondary' && { color: colors.primary },
          variant === 'danger' && { color: colors.danger },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export type Tone = 'info' | 'warn' | 'danger' | 'ok';

export function Banner({ tone, title, detail }: { tone: Tone; title: string; detail?: string }) {
  const bg = tone === 'danger' ? colors.dangerBg : tone === 'warn' ? colors.warnBg : tone === 'ok' ? colors.okBg : colors.surfaceAlt;
  const fg = tone === 'danger' ? colors.danger : tone === 'warn' ? colors.warn : tone === 'ok' ? colors.ok : colors.text;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Text style={[styles.bannerTitle, { color: fg }]}>{title}</Text>
      {detail ? <Text style={styles.bannerDetail}>{detail}</Text> : null}
    </View>
  );
}

export function Pill({ text, tone = 'info' }: { text: string; tone?: Tone }) {
  const bg = tone === 'danger' ? colors.dangerBg : tone === 'warn' ? colors.warnBg : tone === 'ok' ? colors.okBg : colors.surfaceAlt;
  const fg = tone === 'danger' ? colors.danger : tone === 'warn' ? colors.warn : tone === 'ok' ? colors.ok : colors.primary;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space(2),
    borderWidth: 1,
    borderColor: colors.border,
    gap: space(1),
  },
  heading: { ...type.title, color: colors.text },
  body: { ...type.body, color: colors.text },
  label: { ...type.label, color: colors.textMuted },
  field: { gap: space(0.5) },
  input: {
    minHeight: TAP_MIN,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space(1.5),
    ...type.body,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  fieldError: { ...type.label, color: colors.danger, fontWeight: '600' },
  button: {
    minHeight: TAP_MIN,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(2.5),
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 2, borderColor: colors.primary },
  buttonDanger: { backgroundColor: 'transparent', borderWidth: 2, borderColor: colors.danger },
  buttonText: { ...type.body, color: colors.primaryText, fontWeight: '700' },
  banner: { borderRadius: radius.md, padding: space(1.5), gap: 2 },
  bannerTitle: { ...type.label },
  bannerDetail: { ...type.label, color: colors.textMuted, fontWeight: '500' },
  pill: { borderRadius: radius.pill, paddingHorizontal: space(1.25), paddingVertical: space(0.5) },
  pillText: { ...type.label },
});
