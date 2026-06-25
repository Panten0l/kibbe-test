/**
 * Cloudflare Worker — прокси для фото-анализа Kibbe.
 *
 * Зачем нужен: браузер не может безопасно обращаться к API Anthropic
 * (ключ был бы виден всем + CORS блокирует запрос). Worker держит ключ
 * в секрете, сам формирует запрос и отдаёт результат фронтенду.
 *
 * Переменные окружения (Settings → Variables and Secrets в дашборде Cloudflare):
 *   ANTHROPIC_API_KEY  — секрет, твой ключ от console.anthropic.com (обязательно)
 *   ALLOWED_ORIGIN     — адрес твоего сайта, напр. https://username.github.io
 *                        (необязательно; по умолчанию '*' — разрешены все)
 */

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Ты эксперт по системе типажей Дэвида Кибби. Проанализируй изображение и определи типаж из списка: D (Dramatic), FD (Flamboyant Dramatic), SD (Soft Dramatic), N (Natural), SN (Soft Natural), FN (Flamboyant Natural), C (Classic), SC (Soft Classic), DC (Dramatic Classic), R (Romantic), SR (Soft Romantic), G (Gamine), FG (Flamboyant Gamine).

Анализируй: форму лица, черты (мягкие/острые/смешанные), плечевую линию, силуэт фигуры, общую энергетику внешности.

Ответь ТОЛЬКО валидным JSON без markdown и backticks:
{"type":"<код>","confidence":"Уверен / Скорее всего / Предположительно","observations":"2-3 предложения что именно видишь на фото и почему выбрал этот типаж"}`;

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': (env && env.ALLOWED_ORIGIN) || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, env);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Server misconfigured: ANTHROPIC_API_KEY is not set' }, 500, env);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, env);
    }

    const image = payload && payload.image;
    const mime = (payload && payload.mime) || 'image/jpeg';

    if (!image || typeof image !== 'string') {
      return json({ error: 'Missing image data' }, 400, env);
    }
    if (!ALLOWED_MIME.includes(mime)) {
      return json({ error: 'Unsupported image type' }, 400, env);
    }
    // Грубая защита от слишком больших картинок (~15 МБ в base64).
    if (image.length > 21_000_000) {
      return json({ error: 'Image too large' }, 413, env);
    }

    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data: image } },
              { type: 'text', text: 'Определи типаж по Кибби.' },
            ],
          }],
        }),
      });

      const data = await upstream.json();
      return json(data, upstream.status, env);
    } catch (e) {
      return json({ error: 'Upstream request failed' }, 502, env);
    }
  },
};
