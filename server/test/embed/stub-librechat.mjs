import { createServer } from 'node:http';

const CLIENT = 'https://chat.pressroom.example.test';
const port = Number(process.argv[2]);

const escape = (value) => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

createServer((req, res) => {
  const url = new URL(req.url, CLIENT);
  const signedIn = /(?:^|;\s*)refreshToken=valid(?:;|$)/.test(req.headers.cookie ?? '');
  if (req.method === 'POST' && url.pathname === '/api/auth/refresh') {
    if (signedIn) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: 'stub-token', user: { name: 'alice' } }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('Refresh token not provided');
    }
    return;
  }
  if (url.pathname === '/oauth/openid') {
    res.writeHead(302, { Location: '/oauth/openid/callback?code=stub' });
    res.end();
    return;
  }
  if (url.pathname === '/oauth/openid/callback') {
    if (url.searchParams.has('fail')) {
      res.writeHead(302, { Location: `${CLIENT}/login?redirect=false&error=auth_failed` });
      res.end();
      return;
    }
    res.writeHead(302, {
      Location: CLIENT,
      'Set-Cookie': 'refreshToken=valid; Path=/; HttpOnly; Secure; SameSite=Strict',
    });
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(
    `<!doctype html><title>LibreChat stub</title><p id="state">signed in: ${signedIn ? 'yes' : 'no'}</p><p id="path">${escape(url.pathname + url.search)}</p>`,
  );
}).listen(port, '0.0.0.0');
