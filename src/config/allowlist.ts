/**
 * Provider endpoint allowlist.
 *
 * Only these domain suffixes are permitted for outbound provider connections.
 * Localhost (127.0.0.1, ::1, localhost) is always allowed.
 * No Chinese cloud endpoints (Alibaba/Aliyun, ByteDance/Volcano, Tencent,
 * iFlytek, Baidu, etc.) are permitted.
 */

export const ALLOWED_PROVIDER_DOMAINS: readonly string[] = [
  // OpenAI
  'api.openai.com',
  // Anthropic
  'api.anthropic.com',
  // Google
  'generativelanguage.googleapis.com',
  // Groq
  'api.groq.com',
  // Microsoft Edge TTS
  'speech.platform.bing.com',
  'tts.speech.microsoft.com',
  'eastus.tts.speech.microsoft.com',
  // OpenWeatherMap (for weather tool)
  'api.openweathermap.org',
] as const;

/**
 * Blocked domain patterns — any URL containing these substrings is rejected
 * regardless of other rules. This is a defense-in-depth measure.
 */
export const BLOCKED_DOMAIN_PATTERNS: readonly string[] = [
  'aliyun.com',
  'alibabacloud.com',
  'aliyuncs.com',
  'volcengine.com',
  'volces.com',
  'bytedance.com',
  'tencent.com',
  'tencentcloudapi.com',
  'iflytek.com',
  'iflyrec.com',
  'baidu.com',
  'baidubce.com',
  'bdstatic.com',
  'xfyun.cn',
  'qcloud.com',
  'myqcloud.com',
  'npmmirror.com',
  'taobao.org',
  'cnpmjs.org',
] as const;

/** Check if a hostname is localhost */
export function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

/** Check if a URL's host is on the allowlist */
export function isAllowedEndpoint(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // Localhost always allowed
    if (isLocalhost(hostname)) return true;

    // Check blocked patterns first (defense in depth)
    for (const blocked of BLOCKED_DOMAIN_PATTERNS) {
      if (hostname.includes(blocked)) return false;
    }

    // Check against allowlist
    for (const allowed of ALLOWED_PROVIDER_DOMAINS) {
      if (hostname === allowed || hostname.endsWith('.' + allowed)) return true;
    }

    return false;
  } catch {
    return false;
  }
}
