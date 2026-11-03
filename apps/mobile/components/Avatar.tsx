import type { MediaVariants } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../src/theme/theme';
import { Text } from './ui';

/** Round avatar with an initial fallback. Decorative: the row it sits in carries the name. */
export function Avatar({
  photo,
  name,
  size = 48,
}: {
  photo: MediaVariants | null;
  name: string;
  size?: number;
}) {
  const theme = useTheme();
  const style = [
    styles.base,
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: theme.colors.primaryMuted,
    },
  ];
  if (photo)
    return (
      <Image
        source={{ uri: photo.sm }}
        style={style}
        contentFit="cover"
        accessibilityIgnoresInvertColors
        accessible={false}
        importantForAccessibility="no"
      />
    );
  return (
    <View
      style={[style, styles.center]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Text variant="heading" tone="primary">
        {name.trim().charAt(0).toUpperCase() || '·'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
