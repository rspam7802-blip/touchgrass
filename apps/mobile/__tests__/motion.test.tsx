import { screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { FadeIn, Screen, staggerDelay, Text } from '../components/ui';
import { useTheme } from '../src/theme/theme';
import { renderWithProviders } from '../test-utils';

describe('motion and touch (D-154)', () => {
  it('lists cascade only their first few items', () => {
    expect([0, 1, 5, 6, 30].map((i) => staggerDelay(i))).toEqual([0, 60, 300, 0, 0]);
  });

  it('things fade in from transparent, and appear at once with Reduce Motion', async () => {
    await renderWithProviders(
      <FadeIn testID="fade">
        <Text>Hello</Text>
      </FadeIn>,
    );
    expect(StyleSheet.flatten(screen.getByTestId('fade').props.style).opacity).toBe(0);

    // With Reduce Motion on, anything that appears starts in its final state.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    function AfterSettingsLoad() {
      const theme = useTheme();
      return theme.reduceMotion ? (
        <FadeIn testID="still">
          <Text>Hello</Text>
        </FadeIn>
      ) : null;
    }
    await renderWithProviders(<AfterSettingsLoad />);
    const still = await screen.findByTestId('still');
    expect(StyleSheet.flatten(still.props.style).opacity).toBe(1);
  });

  it('screens keep a tap on a result while the keyboard is open (search fix)', async () => {
    await renderWithProviders(
      <Screen testID="s">
        <Text>Body</Text>
      </Screen>,
    );
    const scroll = screen.getByTestId('s-scroll');
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  });
});
