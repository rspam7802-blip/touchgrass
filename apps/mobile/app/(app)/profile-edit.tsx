import { zodResolver } from '@hookform/resolvers/zod';
import { LIMITS } from '@touchgrass/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ChipGroup } from '../../components/ChipGroup';
import { PhotoGrid } from '../../components/PhotoGrid';
import { Button, ErrorState, LoadingState, Screen, Text, TextField } from '../../components/ui';
import { localized, useInterests, useVibeTags } from '../../src/features/catalog/api';
import { usePhotoEditor } from '../../src/features/media/use-photo-editor';
import {
  useMe,
  useSetInterests,
  useSetVibeTags,
  useUpdateProfile,
} from '../../src/features/me/api';
import { errorMessage } from '../../src/lib/errors';

const P = LIMITS.profile;
const FormSchema = z.object({
  displayName: z.string().trim().min(P.displayNameMin).max(P.displayNameMax),
  bio: z.string().trim().max(P.bioMaxLength),
  pronouns: z.string().trim().max(P.pronounsMax),
  languages: z.string().max(200),
});
type FormValues = z.infer<typeof FormSchema>;

/** Edit everything shown on the profile (F-ACC-05). */
export default function ProfileEditScreen() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const interests = useInterests();
  const vibes = useVibeTags();
  const photos = usePhotoEditor();
  const update = useUpdateProfile();
  const saveInterests = useSetInterests();
  const saveVibes = useSetVibeTags();
  const [interestIds, setInterestIds] = useState<string[] | null>(null);
  const [vibeIds, setVibeIds] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    values: me.data
      ? {
          displayName: me.data.displayName ?? '',
          bio: me.data.bio,
          pronouns: me.data.pronouns ?? '',
          languages: me.data.spokenLanguages.join(', '),
        }
      : undefined,
  });

  if (me.isPending || interests.isPending || vibes.isPending) {
    return (
      <Screen testID="profile-edit">
        <LoadingState />
      </Screen>
    );
  }
  const loadError = me.error ?? interests.error ?? vibes.error;
  if (loadError || !me.data || !interests.data || !vibes.data) {
    return (
      <Screen testID="profile-edit">
        <ErrorState
          message={errorMessage(t, loadError) ?? undefined}
          onRetry={() => void Promise.all([me.refetch(), interests.refetch(), vibes.refetch()])}
        />
      </Screen>
    );
  }

  const currentInterests = interestIds ?? me.data.interests.map((i) => i.id);
  const currentVibes = vibeIds ?? me.data.vibeTags.map((v) => v.id);

  const onSave = form.handleSubmit(async (values) => {
    setSaved(false);
    await update.mutateAsync({
      displayName: values.displayName,
      bio: values.bio,
      pronouns: values.pronouns || null,
      spokenLanguages: values.languages
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean),
    });
    if (interestIds) await saveInterests.mutateAsync(interestIds);
    if (vibeIds) await saveVibes.mutateAsync(vibeIds);
    setSaved(true);
  });

  const error = update.error ?? saveInterests.error ?? saveVibes.error;
  return (
    <Screen testID="profile-edit">
      <Text variant="heading">{t('profile.editPhotos')}</Text>
      <PhotoGrid
        photos={photos.photos}
        max={P.maxPhotos}
        canAdd={photos.canAdd}
        adding={photos.adding}
        onAdd={() => void photos.add().catch(() => undefined)}
        onRemove={(id) => {
          if (photos.photos.length > P.minPhotos) void photos.remove(id).catch(() => undefined);
        }}
      />
      <Controller
        control={form.control}
        name="displayName"
        render={({ field, fieldState }) => (
          <TextField
            label={t('onboarding.nameLabel')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error ? t('errors.VALIDATION_FAILED') : null}
            testID="edit-name"
          />
        )}
      />
      <Controller
        control={form.control}
        name="bio"
        render={({ field, fieldState }) => (
          <TextField
            label={t('profile.bioLabel')}
            placeholder={t('profile.bioPlaceholder')}
            value={field.value}
            onChangeText={field.onChange}
            multiline
            maxLength={P.bioMaxLength}
            error={fieldState.error ? t('errors.VALIDATION_FAILED') : null}
            hint={me.data.bioHeld ? t('moderation.held') : undefined}
            testID="edit-bio"
          />
        )}
      />
      <Controller
        control={form.control}
        name="pronouns"
        render={({ field }) => (
          <TextField
            label={t('onboarding.pronounsLabel')}
            value={field.value}
            onChangeText={field.onChange}
            maxLength={P.pronounsMax}
            testID="edit-pronouns"
          />
        )}
      />
      <Controller
        control={form.control}
        name="languages"
        render={({ field }) => (
          <TextField
            label={t('profile.languagesLabel')}
            hint={t('profile.languagesHint')}
            value={field.value}
            onChangeText={field.onChange}
            testID="edit-languages"
          />
        )}
      />
      <Text variant="heading">{t('profile.interests')}</Text>
      <ChipGroup
        label={t('profile.interests')}
        mode="multi"
        max={P.maxInterests}
        options={interests.data.items.map((i) => ({
          id: i.id,
          label: `${i.emoji} ${localized(i.name, i18n.language)}`,
        }))}
        selected={currentInterests}
        onChange={setInterestIds}
        testIDPrefix="edit-interest"
      />
      <Text variant="heading">{t('profile.vibes')}</Text>
      <ChipGroup
        label={t('profile.vibes')}
        mode="multi"
        max={P.maxVibeTags}
        options={vibes.data.items.map((v) => ({
          id: v.id,
          label: `${v.emoji} ${localized(v.name, i18n.language)}`,
        }))}
        selected={currentVibes}
        onChange={setVibeIds}
        testIDPrefix="edit-vibe"
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, error)}
        </Text>
      ) : null}
      {saved ? (
        <Text tone="primary" accessibilityLiveRegion="polite">
          {t('common.done')}
        </Text>
      ) : null}
      <Button
        label={t('common.save')}
        onPress={() => void onSave()}
        loading={update.isPending || saveInterests.isPending || saveVibes.isPending}
        disabled={currentInterests.length < P.minInterests}
        testID="save-profile"
      />
    </Screen>
  );
}
