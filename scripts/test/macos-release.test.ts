import { describe, expect, it } from 'vitest';
import { macReleaseConfig } from '../prepare-macos-release';

const credentials = {
  CSC_LINK: 'test-certificate-base64',
  CSC_KEY_PASSWORD: 'test-export-password',
  APPLE_ID: 'signing@example.invalid',
  APPLE_APP_SPECIFIC_PASSWORD: 'test-notary-password',
  APPLE_TEAM_ID: 'ABCDE12345',
};

describe('Mac signing configuration', () => {
  it.each(Object.keys(credentials))(
    'rejects missing %s instead of producing an unsigned candidate',
    (name) => {
      expect(() => macReleaseConfig('/project', { ...credentials, [name]: '' })).toThrow(name);
    },
  );

  it('rejects disabled signing and invalid team identities', () => {
    expect(() =>
      macReleaseConfig('/project', { ...credentials, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }),
    ).toThrow('签名候选不能禁用身份发现');
    expect(() => macReleaseConfig('/project', { ...credentials, APPLE_TEAM_ID: '-' })).toThrow(
      'APPLE_TEAM_ID 格式无效',
    );
  });

  it('keeps certificate and notarization credentials out of the generated file', () => {
    const config = macReleaseConfig('/project', credentials);
    const serialized = JSON.stringify(config);
    for (const [name, value] of Object.entries(credentials)) {
      if (name !== 'APPLE_TEAM_ID') expect(serialized).not.toContain(value);
    }
    expect(config.forceCodeSigning).toBe(true);
    expect(config.mac?.notarize).toBe(true);
    expect(config.mac?.publish).toBeNull();
  });
});
