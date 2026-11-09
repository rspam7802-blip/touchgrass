import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from './icons';
import { Icon, IconButton } from './ui';

/** Back for screens without a navigation header (Profile, Settings); falls back to Explore. */
export function BackButton({ testID = 'back' }: { testID?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <IconButton
      icon={<Icon icon={ArrowLeft} size={18} />}
      label={t('common.back')}
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/discover');
      }}
      testID={testID}
    />
  );
}
