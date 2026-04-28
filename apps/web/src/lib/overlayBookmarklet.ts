export type OverlayTarget = 'claude' | 'codex';

interface OverlayBookmarkletOptions {
  webOrigin: string;
  sessionId?: string;
  title?: string;
  target?: OverlayTarget;
}

/**
 * Keep bookmarklet short and robust:
 * 1) Store session preset on window so inject.js can read it.
 * 2) Fetch inject.js as text and eval it in the CURRENT tab context.
 *
 * This avoids oversized bookmark URLs and mixed-content script-tag blocks.
 */
export function buildOverlayBookmarklet(options: OverlayBookmarkletOptions): string {
  const webOrigin = options.webOrigin || 'http://localhost:3000';
  const preset = {
    sessionId: options.sessionId ?? '',
    title: options.title ?? '',
    target: options.target === 'codex' ? 'codex' : 'claude',
  };

  const presetJson = JSON.stringify(preset);
  const injectUrl = `${webOrigin}/inject.js`;

  const code = `(function(){` +
    `window.__FA_PRESET=${presetJson};` +
    `fetch(${JSON.stringify(injectUrl+'?v='+Date.now())})` +
    `.then(function(r){return r.text();})` +
    `.then(function(src){(0,eval)(src);})` +
    `.catch(function(e){alert('FeedbackAgent overlay failed: '+(e&&e.message?e.message:e));});` +
  `})()`;

  return `javascript:${code}`;
}
