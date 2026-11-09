import type { LocationPointBody } from '@touchgrass/shared';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSos } from '../src/features/safety/api';
import { confirmSos } from '../src/features/safety/sos';
import { errorMessage } from '../src/lib/errors';
import { Button, Text } from './ui';

/**
 * SOS: calls emergency services, then alerts trusted contacts. If alerting the contacts fails the person
 * is told so plainly and can try again, so nobody believes their contacts know when they don't.
 */
export function SosButton({ testID }: { testID: string }) {
  const { t } = useTranslation();
  const sos = useSos();
  const lastPoint = useRef<LocationPointBody | null>(null);
  const send = (point: LocationPointBody | null) => {
    lastPoint.current = point;
    sos.mutate({ point });
  };
  return (
    <View style={{ gap: 8 }}>
      <Button
        label={t('safety.sos')}
        variant="danger"
        accessibilityHint={t('safety.sosHint')}
        loading={sos.isPending}
        onPress={() => {
          confirmSos(t, send);
        }}
        testID={testID}
      />
      {sos.isSuccess ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID={`${testID}-sent`}>
          {t('safety.sosSent')}
        </Text>
      ) : null}
      {sos.isError ? (
        <>
          <Text tone="danger" accessibilityLiveRegion="assertive" testID={`${testID}-error`}>
            {t('safety.sosFailed')} {errorMessage(t, sos.error) ?? ''}
          </Text>
          <Button
            label={t('safety.sosRetry')}
            variant="secondary"
            loading={sos.isPending}
            onPress={() => {
              send(lastPoint.current);
            }}
            testID={`${testID}-retry`}
          />
        </>
      ) : null}
    </View>
  );
}
