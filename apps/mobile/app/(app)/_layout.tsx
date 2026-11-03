import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { UpdatePrompt } from '../../components/UpdatePrompt';
import { useTrack } from '../../src/features/analytics/analytics';
import { IcebreakerOverlay } from '../../components/at-event/IcebreakerOverlay';
import { AfterEventPrompter } from '../../src/features/after/prompter';
import { RealtimeConnector } from '../../src/features/chat/realtime';
import { PushLinkHandler } from '../../src/features/notifications/push-links';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/theme/theme';

export default function AppLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <>
      <RealtimeConnector />
      <IcebreakerOverlay />
      <PushLinkHandler />
      <AfterEventPrompter />
      <AppOpened />
      <Stack
        screenOptions={{
          headerTintColor: theme.colors.primary,
          headerStyle: { backgroundColor: theme.colors.background },
          headerTitleStyle: { color: theme.colors.text },
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="tutorial" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="profile-edit" options={{ title: t('profile.edit') }} />
        <Stack.Screen name="invites" options={{ title: t('profile.invites') }} />
        <Stack.Screen name="users/[id]" options={{ title: '' }} />
        <Stack.Screen
          name="settings/notifications"
          options={{ title: t('settings.notifications') }}
        />
        <Stack.Screen name="settings/privacy" options={{ title: t('settings.privacy') }} />
        <Stack.Screen name="settings/sessions" options={{ title: t('settings.sessions') }} />
        <Stack.Screen name="settings/language" options={{ title: t('settings.languageTitle') }} />
        <Stack.Screen name="settings/appearance" options={{ title: t('settings.appearance') }} />
        <Stack.Screen name="settings/account" options={{ title: t('settings.account') }} />
        <Stack.Screen name="settings/blocked" options={{ title: t('settings.blockedUsers') }} />
        <Stack.Screen name="contacts" options={{ title: t('squad.findContacts') }} />
        <Stack.Screen name="plot" options={{ title: '' }} />
        <Stack.Screen name="search" options={{ title: t('discover.search') }} />
        <Stack.Screen name="events/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="events/[id]/cancel" options={{ title: '', presentation: 'modal' }} />
        <Stack.Screen name="events/[id]/invite" options={{ title: t('events.inviteTitle') }} />
        <Stack.Screen name="events/[id]/ticket" options={{ title: t('events.ticket') }} />
        <Stack.Screen name="events/[id]/scan" options={{ title: t('events.scan') }} />
        <Stack.Screen name="events/[id]/attendees" options={{ title: t('events.whoIsGoing') }} />
        <Stack.Screen name="events/[id]/plus-one" options={{ title: t('events.plusOneLabel') }} />
        <Stack.Screen name="report" options={{ title: t('report.title'), presentation: 'modal' }} />
        <Stack.Screen
          name="stories/[userId]"
          options={{ headerShown: false, presentation: 'fullScreenModal' }}
        />
        <Stack.Screen
          name="stories/new"
          options={{ title: t('stories.composerTitle'), presentation: 'modal' }}
        />
        <Stack.Screen name="chats/[id]/index" options={{ title: '' }} />
        <Stack.Screen
          name="chats/[id]/poll"
          options={{ title: t('chat.newPoll'), presentation: 'modal' }}
        />
        <Stack.Screen name="events/[id]/icebreakers" options={{ title: t('ate.icebreakers') }} />
        <Stack.Screen name="events/[id]/signal" options={{ title: t('ate.signalTitle') }} />
        <Stack.Screen name="events/[id]/newcomers" options={{ title: t('ate.newcomers') }} />
        <Stack.Screen name="events/[id]/checkout" options={{ title: t('payments.payNow') }} />
        <Stack.Screen name="events/[id]/perk" options={{ title: t('perks.title') }} />
        <Stack.Screen name="payments/[id]/index" options={{ title: t('payments.receipt') }} />
        <Stack.Screen name="payments/[id]/receipt" options={{ title: t('payments.receipt') }} />
        <Stack.Screen name="settings/payments" options={{ title: t('payments.receipts') }} />
        <Stack.Screen name="hosting/index" options={{ title: t('hosting.title') }} />
        <Stack.Screen name="hosting/apply" options={{ title: t('hosting.applyTitle') }} />
        <Stack.Screen name="hosting/account" options={{ title: t('hosting.payoutSetup') }} />
        <Stack.Screen name="hosting/payouts" options={{ title: t('hosting.payouts') }} />
        <Stack.Screen name="hosting/event/[id]" options={{ title: t('hosting.analytics') }} />
        <Stack.Screen name="after/[id]" options={{ title: '', presentation: 'modal' }} />
        <Stack.Screen name="events/[id]/lore" options={{ title: t('lore.title') }} />
        <Stack.Screen name="events/[id]/feedback" options={{ title: t('after.feedbackTitle') }} />
        <Stack.Screen name="free" options={{ title: t('free.title'), presentation: 'modal' }} />
        <Stack.Screen name="crews/index" options={{ title: t('crews.title') }} />
        <Stack.Screen name="crews/new" options={{ title: t('crews.create') }} />
        <Stack.Screen name="crews/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="crews/[id]/schedule" options={{ title: t('crews.schedule') }} />
        <Stack.Screen name="crews/[id]/invite" options={{ title: t('crews.invite') }} />
        <Stack.Screen name="proposals/index" options={{ title: t('proposals.title') }} />
        <Stack.Screen name="proposals/new" options={{ title: t('proposals.create') }} />
        <Stack.Screen name="proposals/[id]" options={{ title: t('proposals.title') }} />
        <Stack.Screen name="badges" options={{ title: t('badges.title') }} />
        <Stack.Screen name="challenges" options={{ title: t('challenges.title') }} />
        <Stack.Screen name="recaps/index" options={{ title: t('recap.title') }} />
        <Stack.Screen name="recaps/[id]" options={{ title: t('recap.title') }} />
        <Stack.Screen name="referrals" options={{ title: t('referrals.title') }} />
        <Stack.Screen name="safety/index" options={{ title: t('safety.title') }} />
        <Stack.Screen name="safety/contacts" options={{ title: t('safety.contactsTitle') }} />
        <Stack.Screen name="safety/share" options={{ title: t('safety.shareTitle') }} />
        <Stack.Screen name="verification" options={{ title: t('verification.title') }} />
        <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
        <Stack.Screen name="events/[id]/story" options={{ title: t('share.sharePlan') }} />
        <Stack.Screen name="settings/calendar" options={{ title: t('calendar.subscribeTitle') }} />
      </Stack>
      <UpdatePrompt />
    </>
  );
}

/** One `app_opened` per launch into the signed-in app (F-PLT-05). */
function AppOpened() {
  const track = useTrack();
  useEffect(() => {
    track('app_opened');
  }, [track]);
  return null;
}
