import type { PortalUser } from './auth.js';

export interface PortalPage {
  path: string;
  title: string;
  intro: string;
  chatPath: string;
}

export const PAGES: PortalPage[] = [
  {
    path: '/',
    title: 'Home',
    intro: 'Ask anything about the work in the shop today.',
    chatPath: '/c/new',
  },
  {
    path: '/estimating',
    title: 'Estimating',
    intro: 'Long documents, estimates and careful reasoning.',
    chatPath: '/c/new?spec=claude-deep',
  },
  {
    path: '/production',
    title: 'Production',
    intro: 'Job status and due dates from Pace.',
    chatPath: `/c/new?spec=claude-everyday&prompt=${encodeURIComponent('Which Pace jobs are due this week?')}`,
  },
];

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - PressRoom portal</title>
<link rel="stylesheet" href="/static/portal.css">
</head>
<body>
${body}
</body>
</html>
`;
}

export function renderPage(page: PortalPage, user: PortalUser, chatOrigin: string): string {
  const nav = PAGES.map(
    (entry) =>
      `<a href="${entry.path}"${entry.path === page.path ? ' aria-current="page"' : ''}>${escapeHtml(entry.title)}</a>`,
  ).join('');
  return layout(
    page.title,
    `<header>
<strong>PressRoom</strong>
<nav>${nav}</nav>
<span class="user">${escapeHtml(user.name || user.upn)} <a href="/logout">Sign out</a></span>
</header>
<main id="portal" data-chat-origin="${escapeHtml(chatOrigin)}" data-chat-path="${escapeHtml(page.chatPath)}" data-pages="${escapeHtml(PAGES.map((entry) => entry.path).join(' '))}">
<h1>${escapeHtml(page.title)}</h1>
<p>${escapeHtml(page.intro)}</p>
<p id="chat-checking" class="notice">Checking your chat sign-in...</p>
<p id="chat-signin" class="notice" hidden>Sign in to the chat once, then it stays in this page. <a id="chat-signin-link" href="${escapeHtml(chatOrigin)}/pressroom/signin">Sign in to chat</a></p>
<p id="chat-unreachable" class="notice" hidden>The chat did not answer. Are you on the office network or VPN?</p>
<iframe id="chat-frame" title="PressRoom chat" allow="microphone; clipboard-read; clipboard-write" hidden></iframe>
</main>
<script src="/static/portal.js"></script>`,
  );
}

export function renderMessage(
  title: string,
  message: string,
  link?: { href: string; text: string },
): string {
  const action = link ? ` <a href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a>` : '';
  return layout(
    title,
    `<main class="message"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}${action}</p></main>`,
  );
}
