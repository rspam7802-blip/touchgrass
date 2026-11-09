import * as Linking from 'expo-linking';
import { readAppEnvironment } from '../../config';

/** Policy pages live on the website so the lawyer-approved text is the same everywhere. */
export type LegalPage = 'terms' | 'privacy' | 'refunds' | 'contact';

export function legalUrl(page: LegalPage): string {
  return `${readAppEnvironment().webUrl}/${page}`;
}

export function openLegal(page: LegalPage): void {
  void Linking.openURL(legalUrl(page));
}
