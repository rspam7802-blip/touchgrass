import { ReportCategory, ReportTargetType } from '@touchgrass/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../components/ChipGroup';
import { Button, Screen, SwitchRow, Text, TextField } from '../../components/ui';
import { useCreateReport } from '../../src/features/social/api';
import { errorMessage } from '../../src/lib/errors';

/** Report a person (and later events, messages, Lore): category, details, optional block (F-SOC-05). */
export default function ReportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ targetType: string; targetId: string; name?: string }>();
  const targetType = ReportTargetType.safeParse(params.targetType);
  const report = useCreateReport();
  const [category, setCategory] = useState<string[]>([]);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);

  if (report.isSuccess) {
    return (
      <Screen testID="report-screen">
        <Text variant="title" accessibilityRole="alert">
          {t('report.thanks')}
        </Text>
        <Button
          label={t('common.done')}
          onPress={() => {
            router.back();
          }}
          testID="report-done"
        />
      </Screen>
    );
  }

  const parsedCategory = ReportCategory.safeParse(category[0]);
  return (
    <Screen testID="report-screen">
      <Text variant="title">
        {params.name ? `${t('report.title')}: ${params.name}` : t('report.title')}
      </Text>
      <Text tone="muted">{t('report.body')}</Text>
      <Text variant="heading">{t('report.categoryLabel')}</Text>
      <ChipGroup
        label={t('report.categoryLabel')}
        mode="single"
        options={ReportCategory.options.map((c) => ({ id: c, label: t(`report.categories.${c}`) }))}
        selected={category}
        onChange={setCategory}
        testIDPrefix="category"
      />
      <TextField
        label={t('report.detailsLabel')}
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={1000}
        testID="report-details"
      />
      {targetType.success && targetType.data === 'user' ? (
        <SwitchRow
          label={t('report.alsoBlock')}
          value={alsoBlock}
          onChange={setAlsoBlock}
          testID="report-also-block"
        />
      ) : null}
      {report.error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, report.error)}
        </Text>
      ) : null}
      <Button
        label={t('report.submit')}
        variant="danger"
        disabled={!parsedCategory.success || !targetType.success || !params.targetId}
        loading={report.isPending}
        onPress={() => {
          if (parsedCategory.success && targetType.success) {
            report.mutate({
              targetType: targetType.data,
              targetId: params.targetId,
              category: parsedCategory.data,
              details,
              alsoBlock,
            });
          }
        }}
        testID="report-submit"
      />
    </Screen>
  );
}
