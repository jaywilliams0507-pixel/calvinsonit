import { test, expect, type Page } from '@playwright/test';
import { services, audit, type OrderView } from '../src/domain';

const orderId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const user = { id: userId, email: 'tester@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-15T12:00:00Z' };
const publicConfig = { testMode: true, supabaseUrl: 'https://staging-example.supabase.co', supabasePublishableKey: 'test-publishable-key', services:services.map(s=>({...s,purchasable:s.id!=='catalog-hosted'})), audit };
const order: OrderView = { id: orderId, serviceId: 'ai-audit', status: 'awaiting_payment', amountCents: 29900, currency: 'usd', intakeCompletedAt: '2026-11-15T12:00:00Z', paidAt: null, dueDate: null, files: [], pendingFiles: [] };

async function configure(page: Page, authenticated = false): Promise<void> {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.route(`**/api/orders/${orderId}/workspace`,route=>route.fulfill({json:{order,fulfilmentStatus:'pending',intake:null,clientEmail:null,paymentIntent:null,paymentUrl:null,reports:[],messages:[]}}));
  await page.route('**/api/config', route => route.fulfill({ json: publicConfig }));
  await page.route('https://staging-example.supabase.co/auth/v1/**', route => route.fulfill({ json: user }));
  if (authenticated) {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, aud: 'authenticated', exp: expires, iat: expires - 3600 })}.test-signature`;
    await page.addInitScript(session => localStorage.setItem('sb-staging-example-auth-token', JSON.stringify(session)), { access_token: token, refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: expires, user });
  }
}

test.describe('Frontend with mocked providers', () => {
  test('email-link sign-in never requests creation of a public account', async ({ page }) => {
    await configure(page);
    let otpBody: Record<string, unknown> | undefined;
    await page.route('https://staging-example.supabase.co/auth/v1/otp**', async route => { otpBody = route.request().postDataJSON() as Record<string, unknown>; await route.fulfill({ json: {} }); });
    await page.goto('/intake/?service=ai-audit');
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await page.getByLabel('Email address', { exact: true }).fill('tester@example.test');
    await page.getByRole('button', { name: 'Email a sign-in link' }).click();
    await expect(page.locator('#auth-message')).toContainText('check its inbox');
    expect(otpBody?.create_user).toBe(false);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('audit intake saves the fixed service and shows pending until a verified event', async ({ page }, testInfo) => {
    await configure(page, true);
    let submitted: Record<string, unknown> | undefined;
    await page.route('**/api/orders', async route => { submitted = route.request().postDataJSON() as Record<string, unknown>; await route.fulfill({ json: order }); });
    await page.route(`**/api/orders/${orderId}`, route => route.fulfill({ json: order }));
    await page.goto('/intake/?service=ai-audit');
    await expect(page.locator('#service-summary')).toContainText('20 questions on each of ChatGPT, Google AI Overviews, Gemini, Perplexity, Copilot: 100 checks total');
    await expect(page.locator('#service-summary')).toContainText('five business days, Eastern Time, after payment and complete intake');
    await page.getByLabel('Business name', { exact: true }).fill('Example Business');
    await page.getByLabel('Business website', { exact: true }).fill('https://example.test');
    await page.getByLabel('Services or products you want to be found for').fill('Catalog software support');
    await page.getByLabel('Markets and customers you serve').fill('Businesses across the United States');
    await page.getByLabel(/I have read the staging terms/).check();
    await expect.poll(() => page.locator('.app-header img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: testInfo.outputPath('audit-intake.png'), fullPage: true });
    await page.getByRole('button', { name: 'Save intake and review order' }).click();
    await expect(page).toHaveURL(new RegExp(`/order/\\?id=${orderId}`));
    await expect(page.locator('#order-status')).toHaveText('Awaiting payment confirmation');
    expect(submitted?.serviceId).toBe('ai-audit');
    expect(submitted).not.toHaveProperty('amountCents');
    expect(submitted).not.toHaveProperty('userId');
    await page.goto(`/order/?id=${orderId}&success=true&session_id=cs_test_unverified`);
    await expect(page.locator('#order-status')).toHaveText('Awaiting payment confirmation');
    await expect(page.getByRole('button', { name: 'Continue to Stripe test checkout' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('catalog files finish before intake completion and use stable upload identities', async ({ page }) => {
    await configure(page, true);
    const catalog: OrderView = { ...order, serviceId: 'catalog-full', amountCents: 59000, status: 'draft', intakeCompletedAt: null, files: [] };
    const sequence: string[] = [];
    const uploadIds: string[] = [];
    await page.route('**/api/orders', async route => { sequence.push('order'); await route.fulfill({ json: catalog }); });
    await page.route(`**/api/orders/${orderId}/files`, async route => {
      sequence.push('file');
      uploadIds.push(route.request().headers()['x-upload-id'] ?? '');
      const name = decodeURIComponent(route.request().headers()['x-file-name'] ?? '');
      catalog.files.push({ id: crypto.randomUUID(), name, bytes: route.request().postDataBuffer()?.byteLength ?? 0 });
      await route.fulfill({ json: { id: catalog.files.at(-1)?.id } });
    });
    await page.route(`**/api/orders/${orderId}/complete-intake`, async route => {
      sequence.push('complete');
      expect(catalog.files).toHaveLength(2);
      catalog.status = 'awaiting_payment'; catalog.intakeCompletedAt = '2026-11-15T12:00:00Z';
      await route.fulfill({ json: catalog });
    });
    await page.route(`**/api/orders/${orderId}`, route => route.fulfill({ json: catalog }));
    await page.goto('/intake/?service=catalog-full');
    await page.getByLabel('Business name', { exact: true }).fill('Example Catalog');
    await page.getByLabel('Business website', { exact: true }).fill('https://example.test');
    await page.getByLabel('Number of products or parts').fill('2400');
    await page.getByLabel('Supplier files', { exact: true }).setInputFiles([
      { name: 'Supplier A.csv', mimeType: 'text/csv', buffer: Buffer.from('sku,name\nA,Item A\n') },
      { name: 'Supplier B.csv', mimeType: 'text/csv', buffer: Buffer.from('sku,name\nB,Item B\n') },
    ]);
    await page.getByLabel(/I have read the staging terms/).check();
    await page.getByRole('button', { name: 'Save intake and review order' }).click();
    await expect(page.locator('#order-status')).toHaveText('Awaiting payment confirmation');
    expect(sequence).toEqual(['order', 'file', 'file', 'complete']);
    expect(uploadIds).toHaveLength(2);
    expect(new Set(uploadIds).size).toBe(2);
    for (const id of uploadIds) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByRole('button', { name: 'Download Supplier A.csv' })).toBeVisible();
  });

  test('a failed upload retains the saved order and reuses its upload identity on retry', async ({ page }) => {
    await configure(page, true);
    const catalog: OrderView = { ...order, serviceId: 'catalog-starter', amountCents: 18900, status: 'draft', intakeCompletedAt: null };
    const ids: string[] = [];
    const orderRequests: string[] = [];
    await page.route('**/api/orders', async route => { orderRequests.push(route.request().postDataJSON().requestId as string); await route.fulfill({ json: catalog }); });
    await page.route(`**/api/orders/${orderId}/files`, async route => {
      ids.push(route.request().headers()['x-upload-id'] ?? '');
      await route.fulfill(ids.length === 1 ? { status: 503, json: { error: 'Temporary upload failure' } } : { json: { id: '33333333-3333-4333-8333-333333333333' } });
    });
    await page.route(`**/api/orders/${orderId}/complete-intake`, route => route.fulfill({ json: { ...catalog, status: 'awaiting_payment' } }));
    await page.route(`**/api/orders/${orderId}`, route => route.fulfill({ json: { ...catalog, status: 'awaiting_payment' } }));
    await page.goto('/intake/?service=catalog-starter');
    await page.getByLabel('Business name', { exact: true }).fill('Example Catalog');
    await page.getByLabel('Business website', { exact: true }).fill('https://example.test');
    await page.getByLabel('Number of products or parts').fill('10');
    await page.getByLabel('Supplier files', { exact: true }).setInputFiles({ name: 'Supplier.csv', mimeType: 'text/csv', buffer: Buffer.from('sku,name\nA,Item A\n') });
    await page.getByLabel(/I have read the staging terms/).check();
    await page.getByRole('button', { name: 'Save intake and review order' }).click();
    await expect(page.locator('#intake-message')).toContainText('Temporary upload failure');
    await expect(page.getByRole('link', { name: 'Continue saved order' })).toHaveAttribute('href', `/order/?id=${orderId}`);
    await page.getByRole('button', { name: 'Save intake and review order' }).click();
    await expect(page.locator('#order-status')).toHaveText('Awaiting payment confirmation');
    expect(ids[0]).toBe(ids[1]);
    expect(orderRequests[0]).toBe(orderRequests[1]);
  });

  test('a saved draft explains unfinished uploads and can resume after a reload', async ({ page }) => {
    await configure(page, true);
    const catalog: OrderView = { ...order, serviceId: 'catalog-starter', amountCents: 18900, status: 'draft', intakeCompletedAt: null, pendingFiles: [{ name: 'Supplier.csv', bytes: 18 }] };
    await page.route(`**/api/orders/${orderId}`, route => route.fulfill({ json: catalog }));
    await page.route(`**/api/orders/${orderId}/files`, async route => {
      expect(decodeURIComponent(route.request().headers()['x-file-name'] ?? '')).toBe('Supplier.csv');
      catalog.pendingFiles = [];
      catalog.files = [{ id: '33333333-3333-4333-8333-333333333333', name: 'Supplier.csv', bytes: 18 }];
      await route.fulfill({ json: { id: catalog.files[0]?.id } });
    });
    await page.goto(`/order/?id=${orderId}`);
    await expect(page.locator('#pending-files-note')).toContainText('Select the same files again');
    await expect(page.getByRole('button', { name: 'Finish intake' })).toBeDisabled();
    await page.reload();
    await expect(page.locator('#pending-files-note')).toContainText('Supplier.csv');
    await page.getByLabel('Add supplier files').setInputFiles({ name: 'Supplier.csv', mimeType: 'text/csv', buffer: Buffer.from('sku,name\nA,Item A\n') });
    await page.getByRole('button', { name: 'Upload files', exact: true }).click();
    await expect(page.locator('#pending-files-note')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Finish intake' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Download Supplier.csv' })).toBeVisible();
  });

  test('contact saves a lead without marketing signup or customer mail request', async ({ page }) => {
    await configure(page);
    let submitted: Record<string, unknown> | undefined;
    await page.route('**/api/leads', async route => { submitted = route.request().postDataJSON() as Record<string, unknown>; await route.fulfill({ json: { received: true } }); });
    await page.goto('/contact/');
    await page.getByLabel('Your name').fill('Example Customer');
    await page.getByLabel('Email address').fill('customer@example.test');
    await page.getByLabel('Message', { exact: true }).fill('Please explain the Catalog Starter file requirements.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('#contact-result')).toContainText('Your message was saved');
    await expect(page.locator('#contact-result')).toContainText('not been added to a mailing list');
    expect(Object.keys(submitted ?? {}).sort()).toEqual(['email', 'message', 'name', 'requestId']);
  });

  test('public-facing copy exposes fixed packages and no live payment or held-service checkout', async ({ page }, testInfo) => {
    await configure(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/catalog-cleanup/');
    for (const service of services.filter(item => item.requiresFiles && item.id!=='catalog-hosted')) await expect(page.locator(`a[href="/intake/?service=${service.id}"]`).first()).toBeVisible();
    await expect(page.locator('a[href="/intake/?service=catalog-hosted"]')).toHaveCount(0);
    await expect(page.locator('main')).toContainText('$1,490');
    await page.screenshot({ path: testInfo.outputPath('catalog-packages.png'), fullPage: true });
    for (const path of ['/google-business-profile/', '/automation/']) {
      await page.goto(path);
      await expect(page.getByRole('note').filter({ hasText: 'Not accepting orders' })).toBeVisible();
      await expect(page.locator('a[href*="stripe.com"]')).toHaveCount(0);
      await expect(page.getByRole('link',{name:'Email about this service'})).toHaveAttribute('href','mailto:hello@calvinsonit.org');
      await expect(page.locator('main a[href*="/intake/"]')).toHaveCount(0);
      expect(await page.locator('main').innerText()).not.toMatch(/\bquote\b/i);
    }
    await page.goto('/ai-visibility-audit/');
    await expect(page.locator('a[href*="buy.stripe.com"]')).toHaveCount(0);
    await expect(page.locator('main')).toContainText('20 questions on each of five engines');
    await expect(page.locator('main')).toContainText('100 checks');
  });

  test('Hosted stays visible but cannot be selected for intake',async({page})=>{
    await configure(page,true);
    await page.goto('/intake/?service=catalog-hosted');
    await expect(page.locator('#page-message')).toContainText('not accepting orders');
    await expect(page.locator('#service option[value="catalog-hosted"]')).toBeDisabled();
    await expect(page.locator('#service option[value="catalog-hosted"]')).toContainText('$1,490');
  });

  test('admin denial never exposes order detail',async({page})=>{
    await configure(page,true);
    await page.route('**/api/admin/orders?*',route=>route.fulfill({status:403,json:{error:'Administrator access required'}}));
    await page.goto(`/admin/?id=${orderId}`);
    await expect(page.locator('#page-message')).toHaveText('Administrator access required');
    await expect(page.locator('#admin-list')).toBeHidden();
    await expect(page.locator('#admin-detail')).toBeHidden();
  });

  test('admin reviews intake and test payment, retries a report then marks it ready',async({page},testInfo)=>{
    await configure(page,true);
    const reportId='33333333-3333-4333-8333-333333333333';
    const detail={order:{...order,status:'paid',dueDate:'2026-11-27'},fulfilmentStatus:'pending',intake:{businessName:'Example Business',notes:'<script>window.testInjection=true</script>'},clientEmail:'tester@example.test',paymentIntent:null,paymentUrl:'https://dashboard.stripe.com/test/payments/pi_fixture',reports:[] as {id:string;name:string;bytes:number}[],messages:[] as {id:string;senderRole:string;body:string;createdAt:string}[]};
    await page.route('**/api/admin/orders?*',route=>route.fulfill({json:[{id:orderId,serviceId:'ai-audit',status:'paid',fulfilmentStatus:detail.fulfilmentStatus,dueDate:'2026-11-27',clientEmail:'tester@example.test'}]}));
    await page.route(`**/api/admin/orders/${orderId}/workspace`,route=>route.fulfill({json:detail}));
    const ids:string[]=[];
    await page.route(`**/api/admin/orders/${orderId}/reports`,async route=>{
      ids.push(route.request().headers()['x-upload-id']??'');
      if(ids.length===1) {await route.fulfill({status:503,json:{error:'Temporary upload failure'}});return;}
      detail.reports=[{id:reportId,name:'report.pdf',bytes:12}];detail.fulfilmentStatus='ready';
      await route.fulfill({json:{id:reportId}});
    });
    await page.route(`**/api/admin/orders/${orderId}/messages`,async route=>{
      const body=route.request().postDataJSON() as {requestId:string;body:string};
      expect(Object.keys(body).sort()).toEqual(['body','requestId']);
      detail.messages.push({id:crypto.randomUUID(),senderRole:'admin',body:body.body,createdAt:'2026-11-21T12:01:00Z'});
      await route.fulfill({json:{id:detail.messages.at(-1)?.id}});
    });
    await page.goto(`/admin/?id=${orderId}`);
    await expect(page.locator('#admin-order-status')).toContainText('paid');
    await expect(page.locator('#admin-intake')).toContainText('<script>');
    expect(await page.evaluate(()=>('testInjection' in window))).toBe(false);
    await expect(page.getByRole('link',{name:'View Stripe test payment'})).toHaveAttribute('href','https://dashboard.stripe.com/test/payments/pi_fixture');
    await page.getByLabel('Report file',{exact:true}).setInputFiles({name:'report.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-fixture')});
    await page.getByRole('button',{name:'Upload report',exact:true}).click();
    await expect(page.locator('#workspace-message')).toContainText('Temporary upload failure');
    await page.getByRole('button',{name:'Upload report',exact:true}).click();
    await expect(page.locator('#workspace-message')).toContainText('client email is queued');
    expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);
    await expect(page.locator('#fulfilment-status')).toHaveText('Report ready');
    await expect(page.getByRole('button',{name:/Download report.pdf/})).toBeVisible();
    await page.getByLabel('Message about this order').fill('Your report is ready. Reply here with questions.');
    await page.getByRole('button',{name:'Send order message',exact:true}).click();
    await expect(page.locator('#workspace-message')).toContainText('email notification is queued');
    await expect(page.locator('#message-list')).toContainText('Reply here with questions');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:testInfo.outputPath('admin-ready.png'),fullPage:true});
  });

  test('client downloads private report and retries an order reply with the same request ID',async({page},testInfo)=>{
    await configure(page,true);
    const reportId='33333333-3333-4333-8333-333333333333';
    const detail={order:{...order,status:'paid'},fulfilmentStatus:'ready',intake:null,clientEmail:null,paymentIntent:null,paymentUrl:null,reports:[{id:reportId,name:'report.pdf',bytes:12}],messages:[{id:'44444444-4444-4444-8444-444444444444',senderRole:'admin',body:'Your report is ready. <img src=x onerror="window.testInjection=true">',createdAt:'2026-11-21T12:00:00Z'}]};
    await page.route(`**/api/orders/${orderId}`,route=>route.fulfill({json:{...order,status:'paid'}}));
    await page.route(`**/api/orders/${orderId}/workspace`,route=>route.fulfill({json:detail}));
    await page.route(`**/api/orders/${orderId}/reports/${reportId}`,route=>{
      expect(route.request().headers().authorization).toContain('Bearer ');
      return route.fulfill({body:'%PDF-fixture',headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="report.pdf"'}});
    });
    const ids:string[]=[];
    await page.route(`**/api/orders/${orderId}/messages`,async route=>{
      const body=route.request().postDataJSON() as {requestId:string;body:string};ids.push(body.requestId);
      if(ids.length===1) {await route.fulfill({status:503,json:{error:'Temporary message failure'}});return;}
      detail.messages.push({id:crypto.randomUUID(),senderRole:'client',body:body.body,createdAt:'2026-11-21T12:01:00Z'});
      await route.fulfill({json:{id:detail.messages.at(-1)?.id}});
    });
    await page.goto(`/order/?id=${orderId}`);
    await expect(page.locator('#message-list')).toContainText('<img');
    expect(await page.locator('#message-list img').count()).toBe(0);
    const download=page.waitForEvent('download');await page.getByRole('button',{name:/Download report.pdf/}).click();
    expect((await download).suggestedFilename()).toBe('report.pdf');
    await page.getByLabel('Message about this order').fill('Thanks. Please clarify item one.');
    await page.getByRole('button',{name:'Send order message',exact:true}).click();
    await expect(page.locator('#workspace-message')).toContainText('Temporary message failure');
    await page.getByRole('button',{name:'Send order message',exact:true}).click();
    await expect(page.locator('#workspace-message')).toContainText('email notification is queued');
    await expect(page.locator('#message-list')).toContainText('Please clarify item one');
    expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:testInfo.outputPath('client-ready.png'),fullPage:true});
  });

  test('callback rejects a stored off-site return URL', async ({ page }) => {
    await configure(page, true);
    await page.addInitScript(() => sessionStorage.setItem('calvinsonit-staging:return', 'https://untrusted.example/'));
    await page.goto('/auth/callback/');
    await expect(page).toHaveURL('http://127.0.0.1:4173/intake/');
  });
});
