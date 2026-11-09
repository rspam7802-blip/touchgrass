import type { RelationshipStatus } from '@touchgrass/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { type SquadAction, useSquadAction } from '../src/features/social/api';
import { errorMessage } from '../src/lib/errors';
import { Button, Text } from './ui';

/** The right squad buttons for a relationship: add / cancel / accept+decline / remove. */
export function SquadActions({
  userId,
  relationship,
  compact = false,
}: {
  userId: string;
  relationship: RelationshipStatus;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const action = useSquadAction();
  const run = (a: SquadAction): void => {
    action.mutate({ action: a, userId });
  };
  const variant = compact ? 'ghost' : 'primary';
  const failure = action.isError ? (
    <Text tone="danger" accessibilityLiveRegion="assertive" testID={`squad-error-${userId}`}>
      {errorMessage(t, action.error)}
    </Text>
  ) : null;
  const withError = (buttons: ReactNode) => (
    <>
      {buttons}
      {failure}
    </>
  );
  switch (relationship) {
    case 'self':
      return null;
    case 'none':
      return withError(
        <Button
          label={t('squad.add')}
          variant={variant}
          loading={action.isPending}
          onPress={() => {
            run('request');
          }}
          testID={`add-${userId}`}
        />,
      );
    case 'request_sent':
      return withError(
        <Button
          label={t('squad.cancelRequest')}
          variant="ghost"
          loading={action.isPending}
          onPress={() => {
            run('cancel');
          }}
          testID={`cancel-${userId}`}
        />,
      );
    case 'request_received':
      return withError(
        <>
          <Button
            label={t('squad.accept')}
            loading={action.isPending}
            onPress={() => {
              run('accept');
            }}
            testID={`accept-${userId}`}
          />
          <Button
            label={t('squad.decline')}
            variant="ghost"
            disabled={action.isPending}
            onPress={() => {
              run('decline');
            }}
            testID={`decline-${userId}`}
          />
        </>,
      );
    case 'squad':
      return compact
        ? null
        : withError(
            <Button
              label={t('squad.remove')}
              variant="ghost"
              loading={action.isPending}
              onPress={() => {
                // Removing someone is hard to undo (they'd have to accept a new request), so ask first.
                Alert.alert(t('squad.removeConfirmTitle'), t('squad.removeConfirmBody'), [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('squad.remove'),
                    style: 'destructive',
                    onPress: () => {
                      run('remove');
                    },
                  },
                ]);
              }}
              testID={`remove-${userId}`}
            />,
          );
  }
}
