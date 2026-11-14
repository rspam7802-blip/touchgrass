import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { DockTabBar } from '../../../components/DockTabBar';
import { useTheme } from '../../../src/theme/theme';

/**
 * Bottom dock (D-144): Explore, Plans, the Plot button, Chats, Squad. Profile and settings stay tabs so their
 * state survives switching, but open from the avatar on Explore and from Profile instead of the dock.
 */
/** Explore is home. Without this the tabs opened on the first file alphabetically (Chats). */
export const unstable_settings = { initialRouteName: 'discover' };

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Tabs
      tabBar={(props) => <DockTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: t('nav.explore'),
          tabBarAccessibilityLabel: t('nav.explore'),
        }}
      />
      <Tabs.Screen
        name="plans"
        options={{
          title: t('nav.events'),
          tabBarAccessibilityLabel: t('nav.events'),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: t('nav.chats'),
          tabBarAccessibilityLabel: t('nav.chats'),
        }}
      />
      <Tabs.Screen
        name="squad"
        options={{
          title: t('nav.squad'),
          tabBarAccessibilityLabel: t('nav.squad'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('nav.profile'),
          tabBarAccessibilityLabel: t('nav.profile'),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('nav.settings'),
          tabBarAccessibilityLabel: t('nav.settings'),
        }}
      />
    </Tabs>
  );
}
