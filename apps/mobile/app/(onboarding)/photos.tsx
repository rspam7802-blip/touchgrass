import { LIMITS } from '@touchgrass/shared';
import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import { OnboardingStep } from '../../components/OnboardingStep';
import { PhotoGrid } from '../../components/PhotoGrid';
import { Button, LoadingState } from '../../components/ui';
import { PhotoAccessDeniedError } from '../../src/features/media/upload';
import { usePhotoEditor } from '../../src/features/media/use-photo-editor';
import { useStepNav } from '../../src/features/me/use-step-nav';
import { errorMessage } from '../../src/lib/errors';

export default function PhotosStep() {
  const { t } = useTranslation();
  const editor = usePhotoEditor();
  const next = useStepNav('photos');
  const usable = editor.photos.filter(
    (p) => p.status === 'ready' || p.status === 'processing',
  ).length;
  return (
    <OnboardingStep
      step="photos"
      title={t('onboarding.photosTitle')}
      body={t('onboarding.photosBody')}
      primaryDisabled={usable < LIMITS.profile.minPhotos}
      error={errorMessage(t, editor.error)}
      onPrimary={next}
    >
      {editor.loading ? (
        <LoadingState />
      ) : (
        <PhotoGrid
          photos={editor.photos}
          max={LIMITS.profile.maxPhotos}
          canAdd={editor.canAdd}
          adding={editor.adding}
          onAdd={() => void editor.add().catch(() => undefined)}
          onRemove={(id) => void editor.remove(id).catch(() => undefined)}
        />
      )}
      {editor.error instanceof PhotoAccessDeniedError ? (
        <Button
          label={t('states.openSettings')}
          variant="secondary"
          onPress={() => void Linking.openSettings()}
          testID="photos-open-settings"
        />
      ) : null}
    </OnboardingStep>
  );
}
