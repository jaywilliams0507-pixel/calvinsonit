import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { OrderView, Service } from './domain';

type PublicService = Pick<Service, 'id' | 'name' | 'amountCents' | 'currency' | 'requiresFiles' | 'maxFiles' | 'maxProducts'>;
type Config = {
  testMode: true;
  supabaseUrl: string;
  supabasePublishableKey: string;
  services: PublicService[];
  audit: { engines: string[]; questionsPerEngine: number };
};
type Intake = { businessName: string; website: string; notes?: string; services?: string; markets?: string; competitors?: string; productCount?: number; distributorCount?: number };
const storagePrefix = 'calvinsonit-staging:';
const uploadIds = new WeakMap<File, string>();
let auth: SupabaseClient;
let config: Config;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Page element missing: ${id}`);
  return found as T;
}

function message(id: string, text: string, state = ''): void {
  const target = element(id);
  target.textContent = text;
  target.dataset.state = state;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function money(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amountCents / 100);
}

function selectedService(id: string): PublicService {
  const service = config.services.find(item => item.id === id);
  if (!service) throw new Error('That service is not available for ordering. Choose a listed service.');
  return service;
}

async function request(path: string, init: RequestInit = {}, signedIn = false): Promise<Response> {
  const headers = new Headers(init.headers);
  if (signedIn) {
    const { data: { session }, error } = await auth.auth.getSession();
    if (error || !session) throw new Error('Please sign in again to continue.');
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (!response.ok) {
    let detail = 'The request could not be completed. Please try again.';
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') detail = body.error;
    } else if (response.status === 403) {
      detail = 'Your preview access has expired. Refresh the page to sign in again.';
    }
    throw new Error(detail);
  }
  return response;
}

async function api<T>(path: string, body?: unknown, signedIn = false): Promise<T> {
  const init: RequestInit = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  };
  return (await request(path, init, signedIn)).json() as Promise<T>;
}

async function busy(button: HTMLButtonElement, work: () => Promise<void>): Promise<void> {
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try { await work(); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); }
}

function field(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function requestId(key: string, payload: unknown): string {
  const signature = JSON.stringify(payload);
  const stored = sessionStorage.getItem(storagePrefix + key);
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && 'signature' in parsed && 'id' in parsed && parsed.signature === signature && typeof parsed.id === 'string') return parsed.id;
    } catch { sessionStorage.removeItem(storagePrefix + key); }
  }
  const id = crypto.randomUUID();
  sessionStorage.setItem(storagePrefix + key, JSON.stringify({ id, signature }));
  return id;
}

function rememberReturnPath(): void {
  sessionStorage.setItem(storagePrefix + 'return', location.pathname + location.search);
}

function returnPath(): string {
  const saved = sessionStorage.getItem(storagePrefix + 'return');
  sessionStorage.removeItem(storagePrefix + 'return');
  if (!saved) return '/intake/';
  const target = new URL(saved, location.origin);
  if (target.origin !== location.origin || !['/intake/', '/order/'].includes(target.pathname)) return '/intake/';
  return target.pathname + target.search;
}

function applySession(session: Session | null): void {
  element('auth-panel').hidden = !!session;
  element('signed-in').hidden = !session;
  element('signed-in-email').textContent = session?.user.email ?? '';
  const page = document.body.dataset.page;
  if (page === 'intake') element('intake-panel').hidden = !session;
  if (!session && page === 'order') element('order-panel').hidden = true;
}

async function connectAuth(onSignedIn?: () => Promise<void>): Promise<void> {
  const signInForm = element<HTMLFormElement>('sign-in-form');
  signInForm.addEventListener('submit', event => {
    event.preventDefault();
    const button = signInForm.querySelector<HTMLButtonElement>('button[type=submit]')!;
    void busy(button, async () => {
      message('auth-message', 'Requesting a sign-in link…');
      rememberReturnPath();
      const { error } = await auth.auth.signInWithOtp({
        email: field(new FormData(signInForm), 'email'),
        options: { shouldCreateUser: false, emailRedirectTo: location.origin + '/auth/callback/' },
      });
      if (error) message('auth-message', 'The sign-in link could not be requested. Use an admitted staging test account, or try again later.', 'error');
      else message('auth-message', 'If this address is admitted to staging, check its inbox. Open the link in this browser.', 'success');
    }).catch(error => message('auth-message', errorMessage(error), 'error'));
  });
  element<HTMLButtonElement>('google-sign-in').addEventListener('click', event => {
    const button = event.currentTarget as HTMLButtonElement;
    void busy(button, async () => {
      rememberReturnPath();
      message('auth-message', 'Opening Google sign-in…');
      const { error } = await auth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/auth/callback/' } });
      if (error) throw new Error('Google sign-in is unavailable. Try your admitted email account instead.');
    }).catch(error => message('auth-message', errorMessage(error), 'error'));
  });
  element<HTMLButtonElement>('sign-out').addEventListener('click', event => {
    const button = event.currentTarget as HTMLButtonElement;
    void busy(button, async () => {
      const { error } = await auth.auth.signOut();
      if (error) throw new Error('Sign-out could not be completed. Please try again.');
      for (const key of Object.keys(sessionStorage)) if (key.startsWith(storagePrefix)) sessionStorage.removeItem(key);
      location.reload();
    }).catch(error => message('page-message', errorMessage(error), 'error'));
  });
  const { data: { session }, error } = await auth.auth.getSession();
  if (error) throw new Error('Your sign-in session could not be read. Refresh the page to try again.');
  applySession(session);
  auth.auth.onAuthStateChange((event, nextSession) => {
    applySession(nextSession);
    if (event === 'SIGNED_IN' && onSignedIn) queueMicrotask(() => { void onSignedIn().catch(error => message('page-message', errorMessage(error), 'error')); });
  });
  if (session && onSignedIn) await onSignedIn();
}

function addServiceOptions(select: HTMLSelectElement): void {
  for (const service of config.services) {
    const option = document.createElement('option');
    option.value = service.id;
    option.textContent = `${service.name} · ${money(service.amountCents, service.currency)}`;
    select.append(option);
  }
}

function validateFiles(files: File[], maximum: number): void {
  if (!files.length || files.length > maximum) throw new Error(`Choose between 1 and ${maximum} supplier files.`);
  for (const file of files) {
    if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('Only CSV and XLSX files are accepted.');
    if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error(`${file.name} must be nonempty and at most 10 MiB.`);
  }
}

async function uploadFiles(orderId: string, files: File[], progress: (text: string) => void): Promise<void> {
  for (const [index, file] of files.entries()) {
    progress(`Uploading file ${index + 1} of ${files.length}: ${file.name}…`);
    let uploadId = uploadIds.get(file);
    if (!uploadId) { uploadId = crypto.randomUUID(); uploadIds.set(file, uploadId); }
    await request(`/api/orders/${orderId}/files`, {
      method: 'POST', body: file,
      headers: {
        'Content-Type': /\.csv$/i.test(file.name) ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'X-File-Name': encodeURIComponent(file.name), 'X-Upload-Id': uploadId,
      },
    }, true);
  }
}

async function intakePage(): Promise<void> {
  const form = element<HTMLFormElement>('intake-form');
  let submission: { signature: string; id: string } | undefined;
  const select = element<HTMLSelectElement>('service');
  addServiceOptions(select);
  const requested = new URLSearchParams(location.search).get('service');
  if (requested && config.services.some(service => service.id === requested)) select.value = requested;
  else if (requested) message('page-message', 'That service is not accepting orders. Choose one of the available fixed-price packages.', 'error');
  else message('page-message', '');
  if (requested && config.services.some(service => service.id === requested)) message('page-message', '');
  const updateService = (): void => {
    const service = selectedService(select.value);
    element('intake-title').textContent = service.name;
    element('hosted-note').hidden = service.id !== 'catalog-hosted';
    const auditFields = element<HTMLFieldSetElement>('audit-fields');
    const catalogFields = element<HTMLFieldSetElement>('catalog-fields');
    auditFields.hidden = auditFields.disabled = service.requiresFiles;
    catalogFields.hidden = catalogFields.disabled = !service.requiresFiles;
    element('distributor-field').hidden = service.id !== 'catalog-hosted';
    element<HTMLInputElement>('distributor-count').required = service.id === 'catalog-hosted';
    element<HTMLInputElement>('distributor-count').disabled = service.id !== 'catalog-hosted';
    element<HTMLInputElement>('product-count').max = String(service.maxProducts);
    element<HTMLInputElement>('intake-files').multiple = service.maxFiles > 1;
    element('file-help').textContent = `Up to ${service.maxFiles} ${service.maxFiles === 1 ? 'file' : 'files'}, CSV or XLSX, at most 10 MiB each. Upload only files you may share. Do not include passwords or unnecessary sensitive information.`;
    element('service-summary').textContent = service.requiresFiles
      ? `${money(service.amountCents, service.currency)} fixed price. Up to ${service.maxProducts.toLocaleString('en-US')} products or parts and ${service.maxFiles} ${service.maxFiles === 1 ? 'file' : 'files'}.`
      : `${money(service.amountCents, service.currency)} fixed price. ${config.audit.questionsPerEngine} questions on each of ${config.audit.engines.join(', ')}: 100 checks total. Delivery in five business days, Eastern Time, after payment and complete intake.`;
  };
  updateService();
  select.addEventListener('change', updateService);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    void busy(button, async () => {
      const service = selectedService(select.value);
      const data = new FormData(form);
      const intake: Intake = { businessName: field(data, 'businessName'), website: field(data, 'website'), notes: field(data, 'notes') };
      const files = Array.from(element<HTMLInputElement>('intake-files').files ?? []);
      if (service.requiresFiles) {
        intake.productCount = Number(field(data, 'productCount'));
        if (service.id === 'catalog-hosted') intake.distributorCount = Number(field(data, 'distributorCount'));
        validateFiles(files, service.maxFiles);
      } else {
        intake.services = field(data, 'services'); intake.markets = field(data, 'markets'); intake.competitors = field(data, 'competitors');
      }
      const payload = { serviceId: service.id, intake, termsAccepted: true };
      message('intake-message', 'Saving your intake…');
      const signature = JSON.stringify(payload);
      if (!submission || submission.signature !== signature) submission = { signature, id: requestId('intake', payload) };
      const order = await api<OrderView>('/api/orders', { ...payload, requestId: submission.id }, true);
      const resume = element<HTMLAnchorElement>('resume-order');
      resume.href = `/order/?id=${order.id}`;
      resume.hidden = false;
      if (service.requiresFiles && order.status === 'draft') {
        await uploadFiles(order.id, files, text => message('intake-message', text));
        message('intake-message', 'Completing your file intake…');
        await api<OrderView>(`/api/orders/${order.id}/complete-intake`, {}, true);
      }
      sessionStorage.removeItem(storagePrefix + 'intake');
      location.assign(`/order/?id=${order.id}`);
    }).catch(error => message('intake-message', errorMessage(error) + ' If an order was saved, use “Continue saved order” to resume it.', 'error'));
  });
  await connectAuth();
}

function contactPage(): void {
  const form = element<HTMLFormElement>('contact-form');
  addServiceOptions(element<HTMLSelectElement>('contact-service'));
  element('contact-panel').hidden = false;
  message('page-message', '');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    void busy(button, async () => {
      const data = new FormData(form);
      const serviceId = field(data, 'serviceId');
      const payload = { name: field(data, 'name'), email: field(data, 'email'), message: field(data, 'message'), ...(serviceId ? { serviceId } : {}) };
      message('contact-result', 'Saving your message…');
      await api<{ received: true }>('/api/leads', { ...payload, requestId: requestId('lead', payload) });
      message('contact-result', 'Your message was saved for CalvinsonIT. You have not been added to a mailing list.', 'success');
      form.hidden = true;
    }).catch(error => message('contact-result', errorMessage(error), 'error'));
  });
}

function dueDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T12:00:00Z') : new Date(value);
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'America/New_York' }).format(date) + ' (Eastern Time)';
}

async function downloadInput(orderId: string, file: OrderView['files'][number]): Promise<void> {
  const response = await request(`/api/orders/${orderId}/files/${file.id}`, {}, true);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function orderPage(): Promise<void> {
  const id = new URLSearchParams(location.search).get('id');
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('This order link is incomplete. Use the confirmation link from your saved intake.');
  const orderId = id;
  let current: OrderView | undefined;
  let pollCount = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const explanations: Record<OrderView['status'], string> = {
    draft: 'Your order is saved. Upload the required supplier files and finish intake before checkout.',
    awaiting_payment: 'Intake is complete. Payment has not yet been confirmed. If you just returned from checkout, confirmation may take a moment. You can refresh the status below.',
    paid: 'Stripe test payment is confirmed and intake is complete. This is a test order; no real charge was made.',
    refunded: 'This test order has been refunded. Work is not scheduled.',
    payment_review: 'This test payment needs review. Work is on hold. Contact CalvinsonIT with your order ID.',
  };
  const labels: Record<OrderView['status'], string> = { draft: 'Intake incomplete', awaiting_payment: 'Awaiting payment confirmation', paid: 'Test payment confirmed', refunded: 'Refunded', payment_review: 'Payment under review' };
  function render(order: OrderView): void {
    const service = selectedService(order.serviceId);
    current = order;
    element('order-panel').hidden = false;
    message('page-message', '');
    element('order-id').textContent = order.id;
    element('order-service').textContent = service.name;
    element('order-price').textContent = money(order.amountCents, order.currency);
    element('order-status').textContent = labels[order.status];
    element('order-explanation').textContent = explanations[order.status];
    element('due-row').hidden = !order.dueDate;
    element('order-due').textContent = order.dueDate ? dueDate(order.dueDate) : '';
    element('order-hosted-note').hidden = service.id !== 'catalog-hosted';
    element('checkout').hidden = order.status !== 'awaiting_payment';
    element('draft-panel').hidden = order.status !== 'draft';
    const pending = order.pendingFiles ?? [];
    element('pending-files-note').hidden = pending.length === 0;
    element('pending-files-note').textContent = `These uploads did not finish: ${pending.map(file => file.name).join(', ')}. Select the same files again to resume them, then finish intake.`;
    const fileList = element('order-files');
    fileList.replaceChildren();
    element('order-files-panel').hidden = order.files.length === 0;
    for (const file of order.files) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${file.name} (${Math.ceil(file.bytes / 1024).toLocaleString('en-US')} KiB)`;
      button.setAttribute('aria-label', `Download ${file.name}`);
      button.addEventListener('click', () => { void busy(button, () => downloadInput(order.id, file)).catch(error => message('order-message', errorMessage(error), 'error')); });
      item.append(button); fileList.append(item);
    }
    const remaining = service.maxFiles - order.files.length;
    element<HTMLFormElement>('upload-form').hidden = remaining <= 0;
    element<HTMLInputElement>('order-file-input').multiple = remaining > 1;
    element('order-file-help').textContent = `You can add up to ${remaining} more ${remaining === 1 ? 'file' : 'files'}. CSV or XLSX, at most 10 MiB each.`;
    element<HTMLButtonElement>('complete-intake').disabled = !order.files.length || pending.length > 0;
  }
  async function refresh(): Promise<void> {
    render(await api<OrderView>(`/api/orders/${orderId}`, undefined, true));
  }
  function schedulePoll(): void {
    if (current?.status !== 'awaiting_payment' || pollCount >= 12) return;
    timer = setTimeout(() => {
      pollCount += 1;
      void refresh().then(schedulePoll).catch(error => message('order-message', errorMessage(error) + ' Use Refresh status to try again.', 'error'));
    }, 5000);
  }
  const uploadForm = element<HTMLFormElement>('upload-form');
  uploadForm.addEventListener('submit', event => {
    event.preventDefault();
    const button = uploadForm.querySelector<HTMLButtonElement>('button[type=submit]')!;
    void busy(button, async () => {
      if (!current) return;
      const files = Array.from(element<HTMLInputElement>('order-file-input').files ?? []);
      validateFiles(files, selectedService(current.serviceId).maxFiles - current.files.length);
      await uploadFiles(orderId, files, text => message('order-message', text));
      element<HTMLInputElement>('order-file-input').value = '';
      await refresh();
      message('order-message', 'Files uploaded. Finish intake when all required files are included.', 'success');
    }).catch(error => {
      message('order-message', errorMessage(error) + ' Use Refresh status to see files already received.', 'error');
    });
  });
  element<HTMLButtonElement>('complete-intake').addEventListener('click', event => {
    const button = event.currentTarget as HTMLButtonElement;
    void busy(button, async () => {
      render(await api<OrderView>(`/api/orders/${orderId}/complete-intake`, {}, true));
      message('order-message', 'Intake is complete. You can now use test checkout.', 'success');
    }).catch(error => message('order-message', errorMessage(error), 'error'));
  });
  element<HTMLButtonElement>('checkout').addEventListener('click', event => {
    const button = event.currentTarget as HTMLButtonElement;
    void busy(button, async () => {
      message('order-message', 'Opening Stripe test checkout…');
      const result = await api<{ url: string }>(`/api/orders/${orderId}/checkout`, {}, true);
      const checkout = new URL(result.url);
      if (checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.stripe.com') throw new Error('The checkout link could not be verified. Please contact CalvinsonIT.');
      location.assign(checkout.href);
    }).catch(error => message('order-message', errorMessage(error), 'error'));
  });
  element<HTMLButtonElement>('refresh-order').addEventListener('click', event => {
    const button = event.currentTarget as HTMLButtonElement;
    void busy(button, async () => { await refresh(); message('order-message', 'Status refreshed.'); }).catch(error => message('order-message', errorMessage(error), 'error'));
  });
  window.addEventListener('pagehide', () => { if (timer) clearTimeout(timer); });
  await connectAuth(async () => { await refresh(); if (timer) clearTimeout(timer); pollCount = 0; schedulePoll(); });
  if (element('auth-panel').hidden === false) message('page-message', 'Sign in to view your saved order.');
}

async function callbackPage(): Promise<void> {
  const params = new URLSearchParams(location.search);
  if (params.has('error')) throw new Error('Sign-in was not completed. Return to intake and try again.');
  const code = params.get('code');
  if (code) {
    const { error } = await auth.auth.exchangeCodeForSession(code);
    history.replaceState({}, '', '/auth/callback/');
    if (error) throw new Error('This sign-in link could not be completed. Open it in the browser where you requested it, or request a new link.');
  }
  const { data: { session }, error } = await auth.auth.getSession();
  if (error || !session) throw new Error('No sign-in session was found. Return to intake and request a new link.');
  location.replace(returnPath());
}

async function start(): Promise<void> {
  config = await api<Config>('/api/config');
  if (config.testMode !== true || !config.supabaseUrl || !config.supabasePublishableKey || !config.services?.length) throw new Error('Staging is not ready yet. Configuration must be completed before taking test orders.');
  const page = document.body.dataset.page;
  if (page === 'contact') { contactPage(); return; }
  auth = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true } });
  if (page === 'intake') await intakePage();
  else if (page === 'order') await orderPage();
  else if (page === 'callback') await callbackPage();
}

void start().catch(error => message('page-message', errorMessage(error), 'error'));
