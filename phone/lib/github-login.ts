import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import type { OAuthIO } from '../../packages/git-client/oauth';
export const oauthIO: OAuthIO = {
  random: async () => Array.from(await Crypto.getRandomBytesAsync(32)).map(b => b.toString(16).padStart(2, '0')).join(''),
  sha256: async value => (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, { encoding: Crypto.CryptoEncoding.BASE64 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  open: url => WebBrowser.openBrowserAsync(url),
  post: async (url, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const github = new URL(url).origin === 'https://github.com';
      const response = await fetch(url, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': github ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: github ? new URLSearchParams(body).toString() : JSON.stringify(body) });
      if (!response.ok) throw new Error('OAuth server rejected the request');
      return await response.json();
    } finally { clearTimeout(timer); }
  },
};
