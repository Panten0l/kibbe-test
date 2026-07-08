/**
 * Cloudflare Worker — бэкенд для теста Kibbe.
 *
 * Делает две вещи:
 *  1) Проксирует фото-анализ в Anthropic (прячет API-ключ + обходит CORS).
 *  2) Принимает лиды и шлёт уведомление Лизе в Telegram.
 *
 * Переменные окружения (Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY   — секрет, ключ console.anthropic.com (для фото)
 *   TELEGRAM_BOT_TOKEN  — секрет, токен бота от @BotFather   (для лидов)
 *   TELEGRAM_CHAT_ID    — секрет/текст, chat_id Лизы          (для лидов)
 *   ALLOWED_ORIGIN      — необязательно, напр. https://kibbe.omanpan.org
 *                         (по умолчанию '*')
 *
 * Тип запроса определяется телом POST:
 *   { image, mime }  → фото-анализ
 *   { lead: {...} }  → отправка лида в Telegram
 */

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Ты эксперт по системе типажей Дэвида Кибби. Проанализируй изображение и определи типаж из списка: D (Dramatic), FD (Flamboyant Dramatic), SD (Soft Dramatic), N (Natural), SN (Soft Natural), FN (Flamboyant Natural), C (Classic), SC (Soft Classic), DC (Dramatic Classic), R (Romantic), SR (Theatrical Romantic), G (Gamine), SG (Soft Gamine), FG (Flamboyant Gamine).

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

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ── Лид → Telegram ── */
async function handleLead(payload, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return json({ error: 'Telegram is not configured' }, 500, env);
  }
  const lead = payload.lead || {};
  const name = String(lead.name || '').slice(0, 200);
  const contact = String(lead.contact || '').slice(0, 200);
  const about = String(lead.about || '').slice(0, 1000);
  const type = String(lead.type || '').slice(0, 100);
  const mode = lead.mode === 'photo' ? 'по фото' : 'по вопросам';

  if (!name && !contact) {
    return json({ error: 'Empty lead' }, 400, env);
  }

  const text =
    '🎯 <b>Новый лид · тест Кибби</b>\n\n' +
    '👤 Имя: ' + escapeHtml(name || '—') + '\n' +
    '📩 Контакт: ' + escapeHtml(contact || '—') + '\n' +
    '✨ Типаж: ' + escapeHtml(type || '—') + '\n' +
    '🧭 Способ: ' + escapeHtml(mode) +
    (about ? '\n📝 О себе: ' + escapeHtml(about) : '');

  try {
    const tg = await fetch(
      'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );
    if (!tg.ok) {
      const detail = await tg.text();
      return json({ error: 'Telegram error', detail }, 502, env);
    }
    return json({ ok: true }, 200, env);
  } catch (e) {
    return json({ error: 'Telegram request failed' }, 502, env);
  }
}

/* ── Фото → Anthropic ── */
async function handlePhoto(payload, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'Server misconfigured: ANTHROPIC_API_KEY is not set' }, 500, env);
  }
  const image = payload.image;
  const mime = payload.mime || 'image/jpeg';

  if (!image || typeof image !== 'string') {
    return json({ error: 'Missing image data' }, 400, env);
  }
  if (!ALLOWED_MIME.includes(mime)) {
    return json({ error: 'Unsupported image type' }, 400, env);
  }
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
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, env);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, env);
    }

    if (payload && payload.lead) {
      return handleLead(payload, env);
    }
    return handlePhoto(payload, env);
  },
};
