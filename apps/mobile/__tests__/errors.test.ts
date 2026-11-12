import type { TFunction } from 'i18next';
import { StorageUploadError } from '../src/features/media/upload';
import { errorMessage } from '../src/lib/errors';

const t = ((key: string, params?: { status?: number }) =>
  params?.status === undefined ? key : `${key}:${String(params.status)}`) as unknown as TFunction;

describe('errorMessage for storage uploads', () => {
  it('says storage could not be reached when no request got through', () => {
    expect(
      errorMessage(t, new StorageUploadError(0, { cause: new Error('host unreachable') })),
    ).toBe('states.uploadUnreachable');
  });

  it("shows storage's answer when it turned the upload down", () => {
    expect(errorMessage(t, new StorageUploadError(403))).toBe('states.uploadFailed:403');
  });
});
