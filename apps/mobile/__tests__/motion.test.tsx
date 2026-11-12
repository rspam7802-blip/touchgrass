import { screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { BrandLogo } from '../components/BrandLogo';
import { LaunchAnimation } from '../components/LaunchAnimation';
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

  it('the logo grows in then sways, and the launch animation covers the app until it has', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    // The cover is hidden from screen readers: it is decoration over the real screen.
    const hidden = { includeHiddenElements: true };
    await renderWithProviders(<LaunchAnimation />);
    expect(screen.getByTestId('launch-animation', hidden)).toBeOnTheScreen();
    // The grass starts flat on the ground line and grows from there.
    const grass = screen.getByTestId('brand-logo-grass', hidden);
    const transform = (StyleSheet.flatten(grass.props.style) as { transform: object[] }).transform;
    expect(transform[0]).toEqual({ scaleY: 0 });
    // Next to the written name the logo is decorative; on its own it carries the brand name.
    expect(screen.getByTestId('brand-logo', hidden).props.accessible).toBe(false);
  });

  it('on its own the logo is labelled with the brand name', async () => {
    await renderWithProviders(<BrandLogo size={112} />);
    expect(screen.getByLabelText('TouchGrass')).toBeOnTheScreen();
  });

  it('with Reduce Motion there is no launch animation and the logo stands still', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    function AfterSettingsLoad() {
      const theme = useTheme();
      return theme.reduceMotion ? (
        <>
          <LaunchAnimation />
          <BrandLogo size={40} />
        </>
      ) : null;
    }
    await renderWithProviders(<AfterSettingsLoad />);
    await screen.findByTestId('brand-logo');
    expect(screen.queryByTestId('launch-animation')).toBeNull();
    const grass = screen.getByTestId('brand-logo-grass');
    const transform = (StyleSheet.flatten(grass.props.style) as { transform: object[] }).transform;
    expect(transform[0]).toEqual({ scaleY: 1 });
  });
});
