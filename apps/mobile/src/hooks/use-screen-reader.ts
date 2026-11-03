import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** True while VoiceOver or TalkBack is on (things that move on their own should wait for the person). */
export function useScreenReader(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      if (mounted) setEnabled(on);
    });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return enabled;
}
