let loading;
export function loadTurnstile() {
  if (loading) return loading;
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => fail(), 20000);
    const fail = () => { clearTimeout(timer); script.remove(); loading = undefined; reject(Error('验证服务加载失败，请稍后重试。')); };
    window.archiveTurnstileLoaded = () => { clearTimeout(timer); resolve(window.turnstile); };
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=archiveTurnstileLoaded';
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

export async function verifyTurnstile(sitekey, action, host) {
  const api = await loadTurnstile();
  const container = document.createElement('div');
  container.className = 'archive-upload-verification';
  (host || document.body).append(container);
  return new Promise((resolve, reject) => {
    let id, settled = false;
    const finish = (token, error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (id !== undefined) api.remove(id);
      container.remove();
      error ? reject(Error(error)) : resolve(token);
    };
    const timer = setTimeout(() => finish(null, '验证超时，请重试。'), 120000);
    try {
      id = api.render(container, {sitekey, action, size: 'compact', retry: 'never',
        callback: token => finish(token),
        'error-callback': () => { finish(null, '验证未通过，请重试。'); return true; },
        'expired-callback': () => finish(null, '验证已过期，请重试。')});
      if (settled && id !== undefined) api.remove(id);
    } catch { finish(null, '验证服务初始化失败，请重试。'); }
  });
}
