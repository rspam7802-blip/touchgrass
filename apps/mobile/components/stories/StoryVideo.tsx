import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

/**
 * A story clip (D-164): plays without controls, follows the viewer's pause, and loops only in the
 * composer preview. The parent's label describes it for screen readers.
 */
export function StoryVideo({
  uri,
  playing,
  loop = false,
  muted = false,
  label,
  style,
  testID,
}: {
  uri: string;
  playing: boolean;
  loop?: boolean;
  muted?: boolean;
  label: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = loop;
    p.muted = muted;
  });
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  return (
    <View
      style={style}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID={testID}
    >
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
      />
    </View>
  );
}
