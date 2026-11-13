import * as ImagePicker from 'expo-image-picker';

/** Opens the front camera for a verification selfie. Null when the person cancels or declines access. */
export async function takeSelfie(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    cameraType: ImagePicker.CameraType.front,
    quality: 1,
    exif: false,
  });
  return res.canceled ? null : (res.assets[0]?.uri ?? null);
}
