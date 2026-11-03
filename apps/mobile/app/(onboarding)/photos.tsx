import { LIMITS } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { OnboardingStep } from '../../components/OnboardingStep';
import { PhotoGrid } from '../../components/PhotoGrid';
import { LoadingState } from '../../components/ui';
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
    </OnboardingStep>
  );
}
