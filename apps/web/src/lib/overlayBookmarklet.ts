export type OverlayTarget = 'claude' | 'codex';

interface OverlayBookmarkletOptions {
  webOrigin: string;
  sessionId?: string;
  title?: string;
  target?: OverlayTarget;
}

export function buildOverlayBookmarklet(options: OverlayBookmarkletOptions) {
  const params = new URLSearchParams();

  if (options.sessionId) params.set('sessionId', options.sessionId);
  if (options.title) params.set('title', options.title);
  if (options.target) params.set('target', options.target);

  const src = `${options.webOrigin}/inject.js${params.toString() ? `?${params.toString()}` : ''}`;
  return `javascript:(function(){var s=document.createElement('script');s.src='${src}';document.head.appendChild(s);})()`;
}
