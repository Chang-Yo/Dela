import { app } from 'electron';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  clearCampusSession,
  flushCampusSession,
  getCampusSession,
} from '../src/main/timetable/session';

app.setPath('userData', process.argv[2]!);
void app.whenReady().then(async () => {
  try {
    const campus = await getCampusSession();
    const phase = process.argv[3];
    if (phase === 'save') {
      await campus.cookies.set({
        url: 'https://i.sjtu.edu.cn/',
        name: 'test-session',
        value: 'synthetic-session',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
      });
      await campus.cookies.set({
        url: 'https://jaccount.sjtu.edu.cn/',
        name: 'test-trust',
        value: 'synthetic-trust',
        secure: true,
        expirationDate: Math.floor(Date.now() / 1000) + 3600,
      });
      await campus.cookies.set({
        url: 'https://i.sjtu.edu.cn/',
        name: 'test-removed',
        value: 'synthetic',
      });
      await campus.cookies.remove('https://i.sjtu.edu.cn/', 'test-removed');
      for (const value of ['old', 'new']) {
        await campus.cookies.set({
          url: 'https://i.sjtu.edu.cn/',
          name: 'test-rotated',
          value,
        });
      }
      await flushCampusSession();
      assert.ok(existsSync(join(app.getPath('userData'), 'campus-session.bin')));
    } else if (phase === 'restore') {
      const cookies = await campus.cookies.get({});
      const restored = cookies.find((cookie) => cookie.name === 'test-session');
      assert.equal(restored?.value, 'synthetic-session');
      assert.equal(restored?.session, true);
      assert.equal(restored?.hostOnly, true);
      assert.equal(restored?.httpOnly, true);
      assert.equal(restored?.secure, true);
      assert.equal(restored?.sameSite, 'lax');
      assert.equal(
        cookies.some((cookie) => cookie.name === 'test-removed'),
        false,
      );
      assert.equal(cookies.find((cookie) => cookie.name === 'test-rotated')?.value, 'new');
      assert.equal(
        cookies.find((cookie) => cookie.name === 'test-trust')?.value,
        'synthetic-trust',
      );
      await clearCampusSession();
      assert.equal((await campus.cookies.get({})).length, 0);
      assert.equal(existsSync(join(app.getPath('userData'), 'campus-session.bin')), false);
    } else {
      assert.equal((await campus.cookies.get({})).length, 0);
    }
    console.log(`Campus session smoke passed: ${phase}`);
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
