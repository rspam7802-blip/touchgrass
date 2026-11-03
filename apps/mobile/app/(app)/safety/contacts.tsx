import { LIMITS, normalizeE164 } from '@touchgrass/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../../components/ui';
import {
  useAddContact,
  useRemoveContact,
  useTrustedContacts,
} from '../../../src/features/safety/api';
import { errorMessage } from '../../../src/lib/errors';

/** Trusted contacts (F-SAF-04): up to three people who get your live location link. */
export default function TrustedContactsScreen() {
  const { t } = useTranslation();
  const q = useTrustedContacts();
  const add = useAddContact();
  const remove = useRemoveContact();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const items = q.data.items;
  const full = items.length >= LIMITS.safety.maxTrustedContacts;
  const e164 = normalizeE164(phone);

  const save = async (): Promise<void> => {
    setError(null);
    if (!e164) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    try {
      await add.mutateAsync({ name: name.trim(), phone: e164 });
      setName('');
      setPhone('');
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <Screen testID="contacts-screen">
      <Text>{t('safety.contactsBody')}</Text>
      {items.length === 0 ? <EmptyState title={t('safety.noContacts')} /> : null}
      {items.map((c) => (
        <View key={c.id} style={styles.row} accessible={false}>
          <View style={styles.grow}>
            <Text variant="label">{c.name}</Text>
            <Text variant="caption" tone="muted">
              {c.phone}
            </Text>
          </View>
          <Button
            label={t('safety.removeContact', { name: c.name })}
            variant="ghost"
            loading={remove.isPending && remove.variables === c.id}
            onPress={() => {
              remove.mutate(c.id);
            }}
            testID={`remove-contact-${c.id}`}
          />
        </View>
      ))}
      {full ? null : (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('safety.addContact')}
          </Text>
          <TextField
            label={t('safety.contactName')}
            value={name}
            onChangeText={setName}
            maxLength={LIMITS.safety.contactNameMaxLength}
            autoComplete="name"
            testID="contact-name"
          />
          <TextField
            label={t('safety.contactPhone')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            testID="contact-phone"
          />
          {error ? (
            <Text tone="danger" accessibilityLiveRegion="assertive" testID="contact-error">
              {error}
            </Text>
          ) : null}
          <Button
            label={t('safety.saveContact')}
            disabled={name.trim().length === 0 || phone.trim().length === 0}
            loading={add.isPending}
            onPress={() => void save()}
            testID="contact-save"
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
});
