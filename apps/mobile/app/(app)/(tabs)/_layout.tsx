import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '../../../components/ui';
import { useTheme } from '../../../src/theme/theme';

/** Tabs grow as features land (plans in Phase 3, discover in Phase 4, chats in Phase 5). */
export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          minHeight: 56,
        },
        tabBarAllowFontScaling: true,
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: t('nav.discover'),
          tabBarAccessibilityLabel: t('nav.discover'),
          tabBarIcon: ({ color }) => <Text style={{ color }}>🧭</Text>,
        }}
      />
      <Tabs.Screen
        name="plans"
        options={{
          title: t('nav.events'),
          tabBarAccessibilityLabel: t('nav.events'),
          tabBarIcon: ({ color }) => <Text style={{ color }}>📍</Text>,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: t('nav.chats'),
          tabBarAccessibilityLabel: t('nav.chats'),
          tabBarIcon: ({ color }) => <Text style={{ color }}>💬</Text>,
        }}
      />
      <Tabs.Screen
        name="squad"
        options={{
          title: t('nav.squad'),
          tabBarAccessibilityLabel: t('nav.squad'),
          tabBarIcon: ({ color }) => <Text style={{ color }}>👯</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('nav.profile'),
          tabBarAccessibilityLabel: t('nav.profile'),
          tabBarIcon: ({ color }) => <Text style={{ color }}>🌱</Text>,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('nav.settings'),
          tabBarAccessibilityLabel: t('nav.settings'),
          tabBarIcon: ({ color }) => <Text style={{ color }}>⚙︎</Text>,
        }}
      />
    </Tabs>
  );
}
