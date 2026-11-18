const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const A = 'http://localhost:21390';
  await p.goto(A + '/-/login');
  await p.waitForTimeout(1500);
  await p.fill('input[name="username"], input[autocomplete="username"], input[type="text"]', 'alice');
  await p.fill('input[type="password"]', 'dev');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3000);
  await ctx.storageState({ path: 'state.json' });
  const org = process.argv[2] || 'riverside-health';
  for (const [name, url] of [
    ['binder', `/${org}/governance`],
    ['doc', `/${org}/governance/-/blob/main/clinical-standards`],
  ]) {
    await p.goto(A + url); await p.waitForTimeout(4000);
    await p.screenshot({ path: `shots/now-${name}.png` });
    console.log(name, p.url());
  }
  await b.close();
})();
