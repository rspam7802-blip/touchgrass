import { fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Keyboard } from 'react-native';
import { PickList } from '../components/PickList';
import { SelectField } from '../components/SelectField';
import { renderWithProviders } from '../test-utils';

const CITIES = [
  'Hyderabad',
  'Agra',
  'Bengaluru',
  'Chennai',
  'Delhi',
  'Kochi',
  'Mumbai',
  'Pune',
  'Surat',
  'Warangal',
].map((name, i) => ({ id: name.toLowerCase(), label: name, group: i === 0 ? 'Open now' : 'Soon' }));

function Harness({ mode, max }: { mode: 'single' | 'multi'; max?: number }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <PickList
      label="Cities"
      options={CITIES}
      selected={selected}
      onChange={setSelected}
      mode={mode}
      max={max}
      testIDPrefix="city"
    />
  );
}

describe('PickList (D-182)', () => {
  it('long lists are searchable, grouped under headings, and say when nothing matches', async () => {
    await renderWithProviders(<Harness mode="single" />);
    expect(screen.getByRole('header', { name: 'Open now' })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('city-search'), 'CHE');
    expect(screen.getByTestId('city-chennai')).toBeOnTheScreen();
    expect(screen.queryByTestId('city-hyderabad')).toBeNull();
    expect(screen.queryByRole('header', { name: 'Open now' })).toBeNull();
    await fireEvent.changeText(screen.getByTestId('city-search'), 'zzz');
    expect(screen.getByTestId('city-empty')).toHaveTextContent(
      'Nothing matches. Try another word.',
    );
  });

  it('single choice replaces the pick; multi choice stops at the maximum', async () => {
    const single = await renderWithProviders(<Harness mode="single" />);
    await fireEvent.press(screen.getByTestId('city-pune'));
    await fireEvent.press(screen.getByTestId('city-agra'));
    expect(screen.getByTestId('city-agra')).toBeChecked();
    expect(screen.getByTestId('city-pune')).not.toBeChecked();
    await single.unmount();

    await renderWithProviders(<Harness mode="multi" max={2} />);
    await fireEvent.press(screen.getByTestId('city-pune'));
    await fireEvent.press(screen.getByTestId('city-agra'));
    expect(screen.getByTestId('city-delhi')).toBeDisabled();
    // Unticking one frees a place.
    await fireEvent.press(screen.getByTestId('city-pune'));
    expect(screen.getByTestId('city-delhi')).not.toBeDisabled();
  });

  it('short lists have no search box', async () => {
    await renderWithProviders(
      <PickList
        label="Few"
        options={CITIES.slice(0, 3)}
        selected={[]}
        onChange={() => undefined}
        mode="single"
        testIDPrefix="few"
      />,
    );
    expect(screen.queryByTestId('few-search')).toBeNull();
  });
});

describe('SelectField and the keyboard', () => {
  it('closes the keyboard when the list opens, so the choices are not hidden behind it', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    await renderWithProviders(
      <SelectField
        label="Category"
        placeholder="Choose a category"
        options={[{ id: 'chai', label: 'Chai runs' }]}
        value={null}
        onChange={() => undefined}
        testID="cat"
      />,
    );
    await fireEvent.press(screen.getByTestId('cat'));
    expect(dismiss).toHaveBeenCalled();
    expect(screen.getByTestId('cat-sheet')).toBeTruthy();
    dismiss.mockRestore();
  });
});
