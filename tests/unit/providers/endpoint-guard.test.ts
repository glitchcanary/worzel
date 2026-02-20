import { describe, it, expect } from 'vitest';
import { guardEndpoint, EndpointBlockedError } from '../../../src/providers/endpoint-guard.js';
import { isAllowedEndpoint } from '../../../src/config/allowlist.js';

describe('isAllowedEndpoint', () => {
  // Allowed endpoints
  it('allows localhost', () => {
    expect(isAllowedEndpoint('http://localhost:11434')).toBe(true);
    expect(isAllowedEndpoint('http://127.0.0.1:11434')).toBe(true);
    expect(isAllowedEndpoint('http://[::1]:11434')).toBe(true);
  });

  it('allows OpenAI', () => {
    expect(isAllowedEndpoint('https://api.openai.com/v1/chat/completions')).toBe(true);
    expect(isAllowedEndpoint('https://api.openai.com/v1/audio/transcriptions')).toBe(true);
    expect(isAllowedEndpoint('https://api.openai.com/v1/audio/speech')).toBe(true);
  });

  it('allows Anthropic', () => {
    expect(isAllowedEndpoint('https://api.anthropic.com/v1/messages')).toBe(true);
  });

  it('allows Groq', () => {
    expect(isAllowedEndpoint('https://api.groq.com/openai/v1/audio/transcriptions')).toBe(true);
  });

  it('allows Microsoft Edge TTS', () => {
    expect(isAllowedEndpoint('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1')).toBe(true);
  });

  // Blocked endpoints — Chinese cloud services
  it('blocks Alibaba/Aliyun', () => {
    expect(isAllowedEndpoint('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation')).toBe(false);
    expect(isAllowedEndpoint('https://nls-gateway-cn-shanghai.aliyuncs.com')).toBe(false);
  });

  it('blocks ByteDance/Volcano', () => {
    expect(isAllowedEndpoint('https://open.volcengineapi.com/api/v3/chat/completions')).toBe(false);
    expect(isAllowedEndpoint('https://openspeech.bytedance.com/api/v1/tts')).toBe(false);
  });

  it('blocks Tencent', () => {
    expect(isAllowedEndpoint('https://hunyuan.tencentcloudapi.com')).toBe(false);
    expect(isAllowedEndpoint('https://tts.cloud.tencent.com')).toBe(false);
  });

  it('blocks Baidu', () => {
    expect(isAllowedEndpoint('https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop')).toBe(false);
  });

  it('blocks iFlytek', () => {
    expect(isAllowedEndpoint('https://spark-api-open.xf.huaweicloud.com')).toBe(false);
    // Note: iflytek.com is blocked but xf.huaweicloud.com is not on the block list
    expect(isAllowedEndpoint('https://iat-api.xfyun.cn/v2/iat')).toBe(false);
    expect(isAllowedEndpoint('https://tts-api.xfyun.cn/v2/tts')).toBe(false);
  });

  it('blocks Chinese npm mirrors', () => {
    expect(isAllowedEndpoint('https://registry.npmmirror.com')).toBe(false);
  });

  // Unknown endpoints
  it('blocks arbitrary unknown endpoints', () => {
    expect(isAllowedEndpoint('https://evil.example.com/api')).toBe(false);
    expect(isAllowedEndpoint('https://random-server.net/steal-data')).toBe(false);
  });

  // Invalid URLs
  it('rejects invalid URLs', () => {
    expect(isAllowedEndpoint('not-a-url')).toBe(false);
    expect(isAllowedEndpoint('')).toBe(false);
  });
});

describe('guardEndpoint', () => {
  it('does not throw for allowed endpoints', () => {
    expect(() => guardEndpoint('https://api.openai.com/v1/chat')).not.toThrow();
    expect(() => guardEndpoint('http://localhost:11434')).not.toThrow();
  });

  it('throws EndpointBlockedError for blocked endpoints', () => {
    expect(() => guardEndpoint('https://dashscope.aliyuncs.com/api')).toThrow(EndpointBlockedError);
    expect(() => guardEndpoint('https://evil.example.com/api')).toThrow(EndpointBlockedError);
  });
});
