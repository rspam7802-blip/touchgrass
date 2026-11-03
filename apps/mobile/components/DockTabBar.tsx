import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { CalendarDays, Compass, MessageCircle, Plus, Users } from './icons';
import { useTheme } from '../src/theme/theme';
import { Icon, type GlyphIcon, Text } from './ui';

/** Tabs shown in the dock, in order; the Plot button sits in the middle. Profile and settings open from headers. */
export const DOCK_TABS = ['discover', 'plans', 'chats', 'squad'] as const;
const ICONS: Record<(typeof DOCK_TABS)[number], GlyphIcon> = {
  discover: Compass,
  plans: CalendarDays,
  chats: MessageCircle,
  squad: Users,
};

/** The mock's bottom dock: frosted bar, lime active tab, big lime "+" in the centre to plot a plan. */
export function DockTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
}: BottomTabBarProps) {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const visible = DOCK_TABS.map((name) => state.routes.find((r) => r.name === name)).filter(
    (r): r is (typeof state.routes)[number] => r !== undefined,
  );

  const tab = (route: (typeof state.routes)[number]) => {
    const focused = state.routes[state.index]?.key === route.key;
    const title = descriptors[route.key]?.options.title;
    const label = typeof title === 'string' ? title : route.name;
    const color = focused ? theme.colors.primary : theme.colors.textMuted;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: focused }}
        testID={`dock-${route.name}`}
        onPress={() => {
          const event = emitter.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        }}
        style={[styles.tab, { minHeight: theme.minTouchTarget }]}
      >
        <Icon
          icon={ICONS[route.name as (typeof DOCK_TABS)[number]]}
          size={22}
          color={color}
          strokeWidth={focused ? 2.4 : 1.8}
        />
        <Text
          variant="caption"
          numberOfLines={1}
          style={{ color, fontWeight: focused ? '700' : '500', fontSize: 11 }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  const half = Math.ceil(visible.length / 2);
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          paddingBottom: Math.max(insets.bottom, 10),
          backgroundColor: theme.colors.background,
          borderTopColor: theme.colors.border,
        },
      ]}
    >
      {visible.slice(0, half).map(tab)}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('events.plot')}
        accessibilityHint={t('a11y.opensScreen', { screen: t('events.plot') })}
        testID="dock-plot"
        onPress={() => {
          router.push('/plot');
        }}
        style={({ pressed }) => [
          styles.plot,
          {
            backgroundColor: theme.colors.primary,
            borderColor: theme.colors.background,
            width: 60,
            height: 60,
          },
          pressed && !theme.reduceMotion ? styles.pressed : null,
        ]}
      >
        <Icon icon={Plus} size={28} color={theme.colors.onPrimary} strokeWidth={2.6} />
      </Pressable>
      {visible.slice(half).map(tab)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  plot: {
    marginTop: -28,
    borderRadius: 30,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#E5FB46',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  pressed: { transform: [{ scale: 0.94 }] },
});
