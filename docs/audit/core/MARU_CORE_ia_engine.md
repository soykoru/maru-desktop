# MARU Original — `core/ia_engine.py` (675 líneas)

> Motor IA multi-proveedor. 4 proveedores con `MODELS` y costos.
> Comando `!ia` + dinámicas `tarot/fortuna/horoscopo`.

## `IAEngine`

### `PROVIDERS` (4)
```python
{
  "groq":   {url: "groq.com/openai/v1/chat/completions",  default: "llama-3.3-70b-versatile",  free: True},
  "gemini": {url: "generativelanguage...gemini.../{model}:generateContent?key={key}",  default: "gemini-2.5-flash-lite",  free: True},
  "openai": {url: "api.openai.com/v1/chat/completions",  default: "gpt-4o-mini",  free: False},
  "claude": {url: "api.anthropic.com/v1/messages",  default: "claude-sonnet-4-6",  free: False},
}
```

### `MODELS` (lista por proveedor)
- **groq**: Llama 3.3 70B, Llama 3.1 8B, Llama 4 Scout 17B, Qwen3 32B.
- **gemini**: Gemini 2.5 Flash Lite, 2.5 Flash, 2.5 Pro.
- **openai**: GPT-4o Mini, GPT-4o, GPT-4.1 Mini, GPT-3.5 Turbo.
- **claude**: Claude Sonnet 4.6, Claude Opus 4.6.

### `_FREE_FALLBACK_ORDER = ["groq", "gemini"]`
Si el proveedor configurado falla por cuota, prueba estos en orden.

### `_COST_RATES` (USD per 1M tokens, in/out)
```python
"claude-sonnet-4-6": (3.0, 15.0)
"claude-opus-4-6":   (15.0, 75.0)
"gpt-4o-mini":       (0.15, 0.60)
"gpt-4o":            (2.50, 10.0)
"gpt-4.1-mini":      (0.40, 1.60)
"gpt-3.5-turbo":     (0.50, 1.50)
```

### `SOYKORU_CONTEXT` (hardcoded)
Bio del streamer para personalizar respuestas. **Requiere editar para
otros usuarios** o hacerlo configurable en G8.

### `_FORTUNE_PROMPTS` (3 prompts dramáticos)
- `suerte` — adivina mística divertida.
- `tarot` — tarotista mística y dramática (carta + significado).
- `horoscopo` — astróloga cósmica.

Todos requieren: NO emojis, NO repetir nombre, máx 3-4 oraciones, español,
texto plano, único cada vez.

### Atributos
- `enabled, provider, api_key, api_keys (dict por proveedor),
  model, max_response_length=400, cooldown_seconds=10,
  system_prompt, _cooldowns (dict), _request_timeout=15,
  _last_meta (dict)`.

## API pública

### `configure(enabled, provider, api_key, model, max_length, cooldown, system_prompt, api_keys)`
- Valida `provider in PROVIDERS`, fallback a `"groq"`.
- `max_length` clamped 100–800.
- `cooldown` mínimo 3.
- `api_keys` dict permite mantener una key por proveedor (usuario cambia
  proveedor sin perder keys).

### `is_ready` (property)
`enabled and api_key`.

### `ask(user, question) → (success, response)`

1. Validaciones: enabled, api_key, question.
2. **Cooldown** por user (`_check_cooldown`).
3. **Detect fortune type**: si match keywords de `suerte/tarot/horoscopo`,
   usa `_FORTUNE_PROMPTS`. Sino: `system_prompt`.
4. `_dispatch(provider, user, question, model, prompt)`.
5. Si OK: `_log_ia_detail(elapsed, len(result))` con tokens y costo.
6. **Si falló por cuota** (palabras `cuota|rate limit|quota|429|sin cuota`):
   itera `_FREE_FALLBACK_ORDER`, prueba con cada uno que tenga `api_keys`.
7. Captura `Timeout`, `ConnectionError`, exceptions genéricas.

### `_detect_fortune_type(question) → "suerte" | "tarot" | "horoscopo" | ""`
Match por keywords:
- **tarot**: `tarot, carta, cartas del destino, tirame las cartas, lee las cartas, lectura de cartas`.
- **horoscopo**: `horoscopo, horóscopo, signo zodiacal, zodiaco, astros, astral`.
- **suerte**: `suerte, fortuna, leeme la suerte, mi suerte, dime mi suerte,
  lee mi suerte, prediccion, predicción, destino, futuro, que me depara,
  adivina, predice`.

### `_log_ia_detail(elapsed, response_len, fallback=False)`
Imprime con tabla de stats:
- Provider/model (truncado a 30 chars).
- ⚡ GRATIS o 💰 DE PAGO con costo USD calculado.
- Tiempo, response chars.
- Tokens in + out + total.

### Métodos por proveedor

#### `_ask_gemini(user, question, prompt, model_override)`
- Models a probar: `[model] + fallback_models` (gemini-2.5-flash-lite,
  gemini-2.5-flash).
- POST a URL con `?key=API_KEY`.
- Body: `{contents: [{parts: [{text: prompt + question}]}],
  generationConfig: {temperature, maxOutputTokens, etc}}`.
- Extrae `candidates[0].content.parts[0].text`.

#### `_ask_groq(user, question, model, prompt)`
- POST a `groq.com/openai/v1/chat/completions`.
- Bearer auth.
- OpenAI-compat schema: `{model, messages: [{role: system}, {role: user}]}`.

#### `_ask_openai(user, question, prompt, model_override)`
- Mismo schema OpenAI.
- Bearer auth con API key.

#### `_ask_claude(user, question, prompt, model_override)`
- POST a `api.anthropic.com/v1/messages`.
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`.
- Body: `{model, max_tokens, system, messages: [{role: user, content}]}`.
- Extrae `content[0].text`.

### `_truncate(text)`
Trunca a `max_response_length` (cortando en último punto/coma si posible).
Limpia emojis con regex.

### `_check_cooldown(user)` / setea timestamp en éxito.

### `get_config() → dict`
Retorna config actual para guardar.

## Notas para el port

- **Misma API en sidecar Python** — los SDKs JS de Anthropic/OpenAI son
  válidos pero mantener Python centraliza la lógica.
- **`_FORTUNE_PROMPTS` con `{soykoru_ctx}`**: el `SOYKORU_CONTEXT` está
  hardcoded — en el plan G considerar hacerlo configurable.
- **`_FREE_FALLBACK_ORDER`** prueba groq → gemini si la cuota se agota.
- **Cooldown por user**: lock + dict, replicar idéntico.
- **Detect fortune type** por keywords sin IA — replicar para mantener
  comportamiento.
- **Truncado de respuesta**: 100-800 chars, optimizado para TTS.
- **API keys persisten por proveedor** (`_ia_api_keys` dict) — usuario
  puede cambiar de proveedor sin perder keys configuradas.
