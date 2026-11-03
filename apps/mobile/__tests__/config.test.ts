import { pointLoopbackAt } from '../src/config';

describe('pointLoopbackAt (phone on the same Wi-Fi as the dev stack)', () => {
  it('points localhost URLs at the machine Metro served the app from', () => {
    expect(pointLoopbackAt('http://localhost:4000', '192.168.1.20:8081')).toBe(
      'http://192.168.1.20:4000',
    );
    expect(pointLoopbackAt('http://127.0.0.1:3000/x', '10.0.0.5:8081')).toBe(
      'http://10.0.0.5:3000/x',
    );
  });
  it('leaves real hosts, missing or loopback Metro hosts alone', () => {
    expect(pointLoopbackAt('https://api.touchgrass.app', '192.168.1.20:8081')).toBe(
      'https://api.touchgrass.app',
    );
    expect(pointLoopbackAt('http://localhost:4000', undefined)).toBe('http://localhost:4000');
    expect(pointLoopbackAt('http://localhost:4000', 'localhost:8081')).toBe(
      'http://localhost:4000',
    );
  });
});
