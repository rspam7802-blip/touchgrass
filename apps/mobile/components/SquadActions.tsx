import type { RelationshipStatus } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { type SquadAction, useSquadAction } from '../src/features/social/api';
import { Button } from './ui';

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
  switch (relationship) {
    case 'self':
      return null;
    case 'none':
      return (
        <Button
          label={t('squad.add')}
          variant={variant}
          loading={action.isPending}
          onPress={() => {
            run('request');
          }}
          testID={`add-${userId}`}
        />
      );
    case 'request_sent':
      return (
        <Button
          label={t('squad.cancelRequest')}
          variant="ghost"
          loading={action.isPending}
          onPress={() => {
            run('cancel');
          }}
          testID={`cancel-${userId}`}
        />
      );
    case 'request_received':
      return (
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
        </>
      );
    case 'squad':
      return compact ? null : (
        <Button
          label={t('squad.remove')}
          variant="ghost"
          loading={action.isPending}
          onPress={() => {
            run('remove');
          }}
          testID={`remove-${userId}`}
        />
      );
  }
}
