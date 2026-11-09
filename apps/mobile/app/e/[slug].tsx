import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EventDetailView } from '../../components/EventDetailView';
import { Button, ErrorState, LoadingState, Screen, Text } from '../../components/ui';
import { useEventBySlug } from '../../src/features/events/api';
import { errorMessage } from '../../src/lib/errors';
import { useAuthFlowStore } from '../../src/stores/auth-flow-store';
import { appArea, useAuthStore } from '../../src/stores/auth-store';

/** Share / invite links (F-EVT-17): `https://…/e/{slug}?i={token}` or `touchgrass://e/{slug}`. */
export default function SharedEventRoute() {
  const { slug, i } = useLocalSearchParams<{ slug: string; i?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const area = useAuthStore((s) => appArea(s.status, s.session?.user));
  if (area === 'loading') return <LoadingState />;
  if (area !== 'app')
    return (
      <Screen testID="shared-event-signed-out">
        <Text variant="title" accessibilityRole="header">
          {t('events.signInToSee')}
        </Text>
        <Button
          label={t('welcome.getStarted')}
          onPress={() => {
            // Keep the link (and its invite token) so the plan opens after sign-up.
            useAuthFlowStore
              .getState()
              .setPendingLink(`/e/${slug}${i ? `?i=${encodeURIComponent(i)}` : ''}`);
            router.replace(area === 'onboarding' ? '/start' : '/');
          }}
        />
      </Screen>
    );
  return <SharedEvent slug={slug} inviteToken={i ?? null} />;
}

function SharedEvent({ slug, inviteToken }: { slug: string; inviteToken: string | null }) {
  const { t } = useTranslation();
  const q = useEventBySlug(slug, inviteToken);
  return (
    <Screen testID="shared-event">
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState
          message={errorMessage(t, q.error) ?? undefined}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <EventDetailView event={q.data} />
      )}
    </Screen>
  );
}
