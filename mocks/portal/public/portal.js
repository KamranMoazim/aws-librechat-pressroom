(() => {
  const RETURN_KEY = 'pressroom.returnPage';
  const TIMEOUT_MS = 10000;
  const root = document.getElementById('portal');
  if (!root) {
    return;
  }
  const chatOrigin = root.dataset.chatOrigin;
  const chatPath = root.dataset.chatPath;
  const pages = (root.dataset.pages || '').split(' ');
  const parts = {
    checking: document.getElementById('chat-checking'),
    signin: document.getElementById('chat-signin'),
    unreachable: document.getElementById('chat-unreachable'),
    frame: document.getElementById('chat-frame'),
  };

  const show = (name) => {
    for (const [key, element] of Object.entries(parts)) {
      element.hidden = key !== name;
    }
  };

  let stored = null;
  try {
    stored = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    stored = null;
  }
  if (stored && stored !== location.pathname && pages.includes(stored)) {
    location.replace(stored);
    return;
  }

  document.getElementById('chat-signin-link').addEventListener('click', () => {
    try {
      sessionStorage.setItem(RETURN_KEY, location.pathname);
    } catch {
      // Without storage the person lands on the home page after sign-in.
    }
  });

  const probe = document.createElement('iframe');
  probe.hidden = true;
  probe.title = 'chat sign-in check';
  probe.src = `${chatOrigin}/pressroom/session.html`;

  const timer = setTimeout(() => {
    probe.remove();
    show('unreachable');
  }, TIMEOUT_MS);

  window.addEventListener('message', (event) => {
    if (event.origin !== chatOrigin || event.source !== probe.contentWindow) {
      return;
    }
    if (!event.data || event.data.type !== 'pressroom-session') {
      return;
    }
    clearTimeout(timer);
    probe.remove();
    if (event.data.signedIn === true) {
      parts.frame.src = `${chatOrigin}${chatPath}`;
      show('frame');
    } else {
      show('signin');
    }
  });

  document.body.append(probe);
})();
