"""Helpers para sanear texto antes de mandarlo a TTS.

La API TikTok TTS trunca el audio cuando se topa con caracteres no
pronunciables como `_`, dígitos, signos. Casos reales reportados:

  - `darklight_ofk` → leía solo "darklight" y se cortaba
  - `cristian_rivasxd` → leía solo "cristian" y se cortaba

Estos helpers replican la lógica de `core.social_system._display_name`
del MARU original (que dejaba SOLO letras + acentos) y la centralizan
para reuso desde cualquier path que mete username dentro de un text TTS:

  - `chat_dispatcher._read_fortune` (donación-suerte / !suerte)
  - `chat_dispatcher._ia_ask` (saludo default si pregunta vacía)
  - `fortunes.read` (defensa interna por si llega name sucio vía RPC)
  - `social._music_speak` (anuncio Spotify "pedido por @user")

Lo que NO se sanea es el texto libre del comentario que el viewer
escribe — eso es contenido del usuario y romperlo lo perjudica.
"""
from __future__ import annotations

import re
from typing import Any

# Letras + acentos español + ñ + ü. Igual que `SocialSystem._display_name`.
_NON_LETTER_RE = re.compile(r"[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]")
_LETTER_RE = re.compile(r"[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]")

# Token = secuencia continua de no-espacios. Inclusivo: deja pasar acentos,
# ñ, etc. El filtrado real lo hace `_repl` mirando si el token CONTIENE
# `@`, `_` o dígito (caracteres que truncan TTS). Las palabras normales
# como "Spotify" pasan intactas.
_TOKEN_RE = re.compile(r"\S+")
# Caracteres que truncan TTS cuando aparecen en username (NO en números
# puros). El `0-9` está acá pero solo se usa para detectar si el token
# *combina* dígitos con letras (señal de username sucio).
_PROBLEMATIC_USER_CHARS_RE = re.compile(r"[@_]")
_DIGIT_RE = re.compile(r"\d")
# Caracteres "peligrosos" del borde del token que conservamos (puntuación
# final como : ! , .). El núcleo del token se sanea, los bordes vuelven.
_TRAILING_PUNCT_RE = re.compile(r"[\.:;,!\?\)\]]+$")
_LEADING_PUNCT_RE = re.compile(r"^[\(\[¿¡]+")


def clean_user_for_tts(raw: Any) -> str:
    """Devuelve solo letras + acentos a partir de un username crudo.

    Ejemplos:
      darklight_ofk       → Darklightofk
      cristian_rivasxd    → Cristianrivasxd
      @luis.perez_88      → Luisperez
      _xX_pro_Xx_         → Xxprxx (vacío sería "usuario")
      ""                  → usuario
    """
    name = str(raw or "").replace("@", "").strip()
    name = _NON_LETTER_RE.sub("", name)
    if not name:
        return "usuario"
    return name.title()


def sanitize_text_usernames(text: str) -> str:
    """Reemplaza tokens tipo username dentro de un texto por su versión
    saneada. Útil para textos generados por el core (e.g. "pedido por
    cristian_rivasxd") donde no podemos limpiar el username en origen
    sin tocar el core.

    NO toca palabras normales que NO contengan `@`, `_` ni dígitos —
    una palabra como "Spotify", "María" o "rock" pasa intacta. La
    puntuación de borde (`,` `.` `:` `!` etc.) se preserva.
    """
    if not text:
        return text

    def _repl(match: re.Match) -> str:
        token = match.group(0)
        # Bug raíz v1.0.42: la versión previa saneaba CUALQUIER token que
        # tuviera dígitos, convirtiendo "12" en "usuario". Por eso el TTS
        # leía "Te quedan usuario usos hoy" en vez de "Te quedan 3 usos
        # hoy", y "Llevas usuario días" en vez de "Llevas 12 días".
        # Fix: solo saneamos cuando el token combina LETRAS + (`@`/`_`/
        # dígito), señal inequívoca de username sucio. Tokens que son
        # SOLO números, o solo `@`/`_` sin letras, pasan intactos —
        # el TTS los pronuncia como número/símbolo correctamente.
        has_letter = bool(_LETTER_RE.search(token))
        has_problem = bool(
            _PROBLEMATIC_USER_CHARS_RE.search(token) or _DIGIT_RE.search(token)
        )
        if not (has_letter and has_problem):
            return token
        # Separar puntuación de borde para no perderla.
        leading = ""
        trailing = ""
        m_lead = _LEADING_PUNCT_RE.match(token)
        if m_lead:
            leading = m_lead.group(0)
            token = token[len(leading):]
        m_trail = _TRAILING_PUNCT_RE.search(token)
        if m_trail:
            trailing = m_trail.group(0)
            token = token[: -len(trailing)]
        # Re-evaluar tras quitar bordes (ej. "12," ya no aplica).
        has_letter = bool(_LETTER_RE.search(token))
        has_problem = bool(
            _PROBLEMATIC_USER_CHARS_RE.search(token) or _DIGIT_RE.search(token)
        )
        if not (has_letter and has_problem):
            return f"{leading}{token}{trailing}"
        return f"{leading}{clean_user_for_tts(token)}{trailing}"

    return _TOKEN_RE.sub(_repl, text)
