# Kibbe Test · Liza Kuncevich

Интерактивный тест по системе типажей Кибби: квиз из 10 вопросов (работает полностью на стороне браузера) + анализ по фото через AI.

## Структура

```
kibbe-test/
├── index.html          ← сам сайт (заливается на GitHub Pages)
├── .nojekyll           ← чтобы GitHub Pages отдавал файлы как есть
├── .gitignore
├── README.md
└── worker/
    ├── worker.js       ← Cloudflare Worker (прокси для фото-анализа)
    └── wrangler.toml   ← конфиг деплоя Worker
```

## Как это работает

- **Квиз** считает результат прямо в браузере — никакого сервера не нужно.
- **Фото-анализ** браузер отправляет на **Cloudflare Worker**, который добавляет
  секретный API-ключ Anthropic и проксирует запрос. Ключ нигде не виден в коде сайта.

---

## Деплой: пошагово

### Шаг 1. Залить сайт на GitHub

```bash
cd kibbe-test
git init
git add .
git commit -m "Kibbe test: initial"
git branch -M main
git remote add origin https://github.com/ТВОЙ_ЛОГИН/kibbe-test.git
git push -u origin main
```

(Сначала создай пустой репозиторий `kibbe-test` на github.com — без README.)

### Шаг 2. Включить GitHub Pages

1. Репозиторий → **Settings → Pages**.
2. Source: **Deploy from a branch**, ветка `main`, папка `/ (root)` → **Save**.
3. Через 1–2 минуты сайт будет на `https://ТВОЙ_ЛОГИН.github.io/kibbe-test/`.

На этом этапе **квиз уже полностью работает**. Дальше — только для фото-анализа.

### Шаг 3. Развернуть Worker (для фото-анализа)

Нужен бесплатный аккаунт на [cloudflare.com](https://dash.cloudflare.com) и
API-ключ Anthropic с [console.anthropic.com](https://console.anthropic.com).

```bash
cd worker
npx wrangler login                       # вход в Cloudflare
npx wrangler secret put ANTHROPIC_API_KEY  # вставить ключ, он сохранится как секрет
npx wrangler deploy                      # деплой
```

После деплоя в консоли появится адрес вида
`https://kibbe-proxy.ТВОЙ-АККАУНТ.workers.dev` — скопируй его.

### Шаг 4. Связать сайт с Worker

1. Открой `index.html`, найди строку вверху скрипта:
   ```js
   const WORKER_URL = '';
   ```
   Вставь туда адрес Worker:
   ```js
   const WORKER_URL = 'https://kibbe-proxy.ТВОЙ-АККАУНТ.workers.dev';
   ```
2. (Рекомендуется) В `worker/wrangler.toml` замени `ALLOWED_ORIGIN = "*"` на свой
   адрес сайта, напр. `"https://ТВОЙ_ЛОГИН.github.io"`, и снова `npx wrangler deploy`.
   Это запретит чужим сайтам использовать твой Worker.
3. Закоммить и запушить изменения:
   ```bash
   git add index.html worker/wrangler.toml
   git commit -m "Connect frontend to Worker"
   git push
   ```

Готово — фото-анализ заработает.

### Шаг 5. Свой домен (необязательно)

1. Репозиторий → **Settings → Pages → Custom domain** → впиши домен (напр. `test.lizakuncevich.com`).
2. У регистратора домена добавь DNS-запись `CNAME` → `ТВОЙ_ЛОГИН.github.io`.
3. Дождись проверки и включи **Enforce HTTPS**.
4. Не забудь обновить `ALLOWED_ORIGIN` в Worker на новый домен.

---

## Стоимость

Всё в рамках бесплатных тарифов: GitHub Pages — бесплатно, Cloudflare Workers —
100 000 запросов/день бесплатно. Платный только сам API Anthropic за фото-анализ
(тарифицируется по факту использования).
