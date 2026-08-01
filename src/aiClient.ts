export type AiErrorCode =
  | 'auth'
  | 'model'
  | 'rate_limit'
  | 'request'
  | 'network'
  | 'timeout'
  | 'server'
  | 'response';

export interface AiRequestEvent {
  phase: 'requesting' | 'retrying';
  attempt: number;
  maxAttempts: number;
  delayMs?: number;
}

export interface AiConnectionResult {
  endpoint: string;
  latencyMs: number;
  model: string;
}

export interface ChatCompletionConfig {
  apiKey: string;
  baseUrl: string;
  jsonMode: boolean;
  maxRetries: string;
  model: string;
  requestTimeout: string;
}

export interface ChatCompletionMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export interface ChatCompletionResult {
  content: string;
  endpoint: string;
  model: string;
  retries: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

interface RequestOptions {
  fetchImpl?: typeof fetch;
  maxTokens: number;
  onEvent?: (event: AiRequestEvent) => void;
  retryDelayMs?: number;
  signal: AbortSignal;
}

export class AiRequestError extends Error {
  code: AiErrorCode;
  retryable: boolean;
  status?: number;
  retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      code: AiErrorCode;
      retryable?: boolean;
      status?: number;
      retryAfterMs?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'AiRequestError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

function abortError(): DOMException {
  return new DOMException('操作已取消', 'AbortError');
}

function boundedInt(
  value: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

export function resolveChatEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new AiRequestError('Base URL 不能为空。', { code: 'request' });
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AiRequestError('Base URL 格式无效。', { code: 'request' });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AiRequestError('Base URL 仅支持 HTTP 或 HTTPS。', {
      code: 'request',
    });
  }
  return /\/chat\/completions$/i.test(url.pathname)
    ? url.toString()
    : `${trimmed}/chat/completions`;
}

function contentFromMessage(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (
        typeof part === 'object' &&
        part !== null &&
        'text' in part &&
        typeof part.text === 'string'
      ) {
        return part.text;
      }
      return '';
    })
    .join('');
}

function errorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as ChatResponse;
    return String(parsed.error?.message || body || '未知请求错误')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  } catch {
    return body.replace(/\s+/g, ' ').trim().slice(0, 300);
  }
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function redactSecret(value: string, secret: string): string {
  return secret.trim() ? value.split(secret.trim()).join('[已隐藏]') : value;
}

function responseError(
  response: Response,
  body: string,
  apiKey: string,
): AiRequestError {
  const detail = redactSecret(errorDetail(body), apiKey);
  const shared = { status: response.status };
  if (response.status === 401 || response.status === 403) {
    return new AiRequestError(`API Key 无效或没有权限：${detail}`, {
      ...shared,
      code: 'auth',
    });
  }
  if (response.status === 404) {
    return new AiRequestError(`接口或模型不存在，请检查 Base URL 和模型名称：${detail}`, {
      ...shared,
      code: 'model',
    });
  }
  if (response.status === 429) {
    return new AiRequestError(`接口限流或余额不足：${detail}`, {
      ...shared,
      code: 'rate_limit',
      retryable: true,
      retryAfterMs: retryAfterMs(response),
    });
  }
  if (response.status >= 500) {
    return new AiRequestError(`模型服务暂时不可用（HTTP ${response.status}）：${detail}`, {
      ...shared,
      code: 'server',
      retryable: true,
    });
  }
  return new AiRequestError(`请求被接口拒绝（HTTP ${response.status}）：${detail}`, {
    ...shared,
    code: 'request',
  });
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestOnce(
  endpoint: string,
  config: ChatCompletionConfig,
  messages: ChatCompletionMessage[],
  options: RequestOptions,
): Promise<Omit<ChatCompletionResult, 'retries'>> {
  if (options.signal.aborted) throw abortError();
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs =
    boundedInt(config.requestTimeout, 45, 5, 120) * 1000;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        stream: false,
        max_tokens: options.maxTokens,
        ...(config.jsonMode
          ? { response_format: { type: 'json_object' } }
          : {}),
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw responseError(response, body, config.apiKey);

    let parsed: ChatResponse;
    try {
      parsed = JSON.parse(body) as ChatResponse;
    } catch (error) {
      throw new AiRequestError(
        'AI 接口没有返回兼容的 Chat Completions JSON。',
        { code: 'response', cause: error },
      );
    }
    const content = contentFromMessage(parsed.choices?.[0]?.message?.content);
    if (!content.trim()) {
      throw new AiRequestError('AI 返回了空内容。', { code: 'response' });
    }
    return {
      content,
      endpoint,
      model: parsed.model || config.model,
      usage: {
        promptTokens: parsed.usage?.prompt_tokens ?? 0,
        completionTokens: parsed.usage?.completion_tokens ?? 0,
      },
    };
  } catch (error) {
    if (options.signal.aborted) throw abortError();
    if (timedOut) {
      throw new AiRequestError(
        `模型响应超过 ${Math.round(timeoutMs / 1000)} 秒，已自动终止本次请求。`,
        { code: 'timeout', retryable: true, cause: error },
      );
    }
    if (error instanceof AiRequestError) throw error;
    throw new AiRequestError(
      '无法连接模型接口。请检查网络、Base URL 和浏览器跨域权限。',
      { code: 'network', retryable: true, cause: error },
    );
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener('abort', onAbort);
  }
}

export async function requestChatCompletion(
  config: ChatCompletionConfig,
  messages: ChatCompletionMessage[],
  options: RequestOptions,
): Promise<ChatCompletionResult> {
  if (!config.model.trim()) {
    throw new AiRequestError('模型名称不能为空。', { code: 'request' });
  }
  const endpoint = resolveChatEndpoint(config.baseUrl);
  const maxRetries = boundedInt(config.maxRetries, 2, 0, 4);
  const maxAttempts = maxRetries + 1;
  let lastError: AiRequestError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    options.onEvent?.({ phase: 'requesting', attempt, maxAttempts });
    try {
      const result = await requestOnce(endpoint, config, messages, options);
      return { ...result, retries: attempt - 1 };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      lastError =
        error instanceof AiRequestError
          ? error
          : new AiRequestError('模型请求失败。', {
              code: 'network',
              retryable: true,
              cause: error,
            });
      if (!lastError.retryable || attempt >= maxAttempts) throw lastError;
      const baseDelay = Math.max(0, options.retryDelayMs ?? 800);
      const delayMs = Math.min(
        lastError.retryAfterMs ?? baseDelay * 2 ** (attempt - 1),
        10_000,
      );
      options.onEvent?.({
        phase: 'retrying',
        attempt,
        maxAttempts,
        delayMs,
      });
      await waitForRetry(delayMs, options.signal);
    }
  }
  throw lastError ?? new AiRequestError('模型请求失败。', { code: 'network' });
}
