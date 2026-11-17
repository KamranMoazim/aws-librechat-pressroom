(() => {
  const portalOrigin = `https://${location.hostname.replace(/^chat\./, 'portal.')}`;

  const signedIn = async () => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    if (
      !response.ok ||
      !(response.headers.get('content-type') || '').includes('application/json')
    ) {
      return false;
    }
    const body = await response.json();
    return typeof body?.token === 'string' && body.token.length > 0;
  };

  signedIn()
    .catch(() => false)
    .then((result) => {
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'pressroom-session', signedIn: result }, portalOrigin);
      }
    });
})();
