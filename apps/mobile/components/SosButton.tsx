import type { LocationPointBody } from '@touchgrass/shared';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import * as SMS from 'expo-sms';
import { useMe } from '../src/features/me/api';
import { useSos, useTrustedContacts } from '../src/features/safety/api';
import { shareText } from '../src/features/share/share';
import { confirmSos } from '../src/features/safety/sos';
import { errorMessage } from '../src/lib/errors';
import { Button, Text } from './ui';

/**
 * SOS: calls emergency services, then alerts trusted contacts. If alerting the contacts fails the person
 * is told so plainly and can try again, so nobody believes their contacts know when they don't. When the
 * server could not text anyone (it sends no SMS, D-166), the phone's own Messages app opens with every
 * contact and the live link filled in.
 */
export function SosButton({ testID }: { testID: string }) {
  const { t } = useTranslation();
  const sos = useSos();
  const contacts = useTrustedContacts();
  const me = useMe();
  const lastPoint = useRef<LocationPointBody | null>(null);
  const share = sos.data?.share ?? null;
  const phones = (contacts.data?.items ?? []).map((c) => c.phone);
  const textYourself = share !== null && share.contactsNotified === 0 && phones.length > 0;
  const textThem = async (): Promise<void> => {
    if (!share) return;
    const message = t('safety.sosMessage', {
      name: me.data?.displayName ?? '',
      url: share.link,
    });
    if (await SMS.isAvailableAsync()) await SMS.sendSMSAsync(phones, message);
    else await shareText(message);
  };
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
      {sos.isSuccess && !textYourself ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID={`${testID}-sent`}>
          {t('safety.sosSent')}
        </Text>
      ) : null}
      {textYourself ? (
        <>
          <Text
            tone="danger"
            accessibilityLiveRegion="assertive"
            testID={`${testID}-text-yourself`}
          >
            {t('safety.sosTextYourself')}
          </Text>
          <Button
            label={t('safety.sosTextContacts')}
            variant="danger"
            onPress={() => void textThem()}
            testID={`${testID}-text-contacts`}
          />
        </>
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
