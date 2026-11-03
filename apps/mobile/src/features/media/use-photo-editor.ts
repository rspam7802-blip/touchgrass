import { LIMITS, type MeResponse } from '@touchgrass/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApi } from '../../providers/api-context';
import { useMe, useSetPhotos } from '../me/api';
import { compressImage, pickImage, uploadImage } from './upload';

/** Add/remove/reorder profile photos; polls while any photo is still processing on the server. */
export function usePhotoEditor() {
  const { client } = useApi();
  const me = useMe();
  const setPhotos = useSetPhotos();
  const photos: MeResponse['photos'] = me.data?.photos ?? [];
  const processing = photos.some((p) => p.status === 'processing');

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void me.refetch(), 2000);
    return () => {
      clearInterval(timer);
    };
  }, [processing, me]);

  const add = useMutation({
    mutationFn: async () => {
      const uri = await pickImage();
      if (!uri) return null;
      const asset = await uploadImage(client, 'profile_photo', await compressImage(uri));
      return setPhotos.mutateAsync([...photos.map((p) => p.mediaAssetId), asset.id]);
    },
  });

  return {
    photos,
    loading: me.isPending,
    canAdd: photos.length < LIMITS.profile.maxPhotos,
    add: () => add.mutateAsync(),
    adding: add.isPending,
    remove: (id: string) =>
      setPhotos.mutateAsync(photos.filter((p) => p.mediaAssetId !== id).map((p) => p.mediaAssetId)),
    error: add.error ?? setPhotos.error,
  };
}
