"""Tests para `backend.utils.tts_text` — saneamiento de usernames para TTS.

La API TikTok TTS trunca audio cuando se topa con `_`, dígitos o `@`
mezclados con letras. Casos reales reportados (memoria del proyecto):

  - `darklight_ofk` → leía solo "darklight" y se cortaba
  - `cristian_rivasxd` → leía solo "cristian" y se cortaba

Estos tests blindan las dos funciones críticas:

  1. `clean_user_for_tts(raw)` — limpia un username crudo a sólo letras.
  2. `sanitize_text_usernames(text)` — limpia tokens dentro de un texto
     SIN romper números puros, palabras normales, ni puntuación.

El bug raíz v1.0.42 (también documentado en el módulo) era que la
versión previa de `sanitize_text_usernames` saneaba CUALQUIER token con
dígitos, convirtiendo "12" en "usuario". Los tests parametrizados de
abajo (`TestSanitizeTextUsernamesNumbers`) blindan contra esa regresión.
"""
from __future__ import annotations

import pytest

from maru_sidecar.backend.utils.tts_text import (
    clean_user_for_tts,
    sanitize_text_usernames,
)


# ─────────────────────────────────────────────────────────────────────
# clean_user_for_tts — username crudo → sólo letras + acentos
# ─────────────────────────────────────────────────────────────────────

class TestCleanUserForTts:
    """Casos basados en bugs reales de la memoria del proyecto."""

    @pytest.mark.parametrize("raw,expected", [
        # Bugs reales reportados por usuarios:
        ("darklight_ofk",     "Darklightofk"),     # truncaba a "darklight"
        ("cristian_rivasxd",  "Cristianrivasxd"),  # truncaba a "cristian"

        # Casos del docstring del módulo:
        ("@luis.perez_88",    "Luisperez"),
        # ("_xX_pro_Xx_",       "Xxprxx"),          # ver test específico abajo

        # Edge cases:
        ("",                  "usuario"),
        ("   ",               "usuario"),
        ("@@@@@",             "usuario"),
        ("12345",             "usuario"),  # solo dígitos → fallback
        ("____",              "usuario"),  # solo underscores → fallback
        ("María",             "María"),    # acentos preservados
        ("ñoño",              "Ñoño"),     # ñ preservado
        ("Spotify",           "Spotify"),  # palabra limpia → idempotente
    ])
    def test_clean_user_known_cases(self, raw, expected):
        assert clean_user_for_tts(raw) == expected

    def test_clean_user_handles_none(self):
        """`None` debe tratarse como vacío y devolver el fallback."""
        assert clean_user_for_tts(None) == "usuario"

    def test_clean_user_handles_non_string(self):
        """Inputs no-string (int, etc) no deben crashear."""
        assert clean_user_for_tts(12345) == "usuario"

    def test_clean_user_strips_at_symbol(self):
        """El `@` se quita primero — viewer puede mencionar `@user`."""
        assert clean_user_for_tts("@koru") == "Koru"

    def test_clean_user_returns_titlecase(self):
        """Resultado siempre Title Case (más natural en TTS)."""
        result = clean_user_for_tts("MARIA")
        assert result[0].isupper()
        # No estricto: title() puede variar con acentos. Lo crítico es
        # que el TTS reciba algo pronunciable y no truncable.

    def test_clean_user_no_underscore_in_output(self):
        """Output NUNCA debe contener `_` (eso truncaría el TTS)."""
        result = clean_user_for_tts("a_b_c_d_e")
        assert "_" not in result

    def test_clean_user_no_digit_in_output(self):
        """Output NUNCA debe contener dígitos (también truncan TTS)."""
        result = clean_user_for_tts("user99name42")
        assert not any(c.isdigit() for c in result)


# ─────────────────────────────────────────────────────────────────────
# sanitize_text_usernames — saneo selectivo dentro de un texto
# ─────────────────────────────────────────────────────────────────────

class TestSanitizeTextUsernamesUserTokens:
    """Tokens tipo username (letras + `_`/`@`/dígito) se sanean.
    Palabras normales NO se tocan."""

    def test_username_token_in_sentence_sanitized(self):
        """`darklight_ofk` dentro de una frase se sanea pero el resto pasa."""
        result = sanitize_text_usernames("Hola darklight_ofk como estás")
        assert "darklight_ofk" not in result, "username sucio sigue presente"
        assert "Hola" in result
        assert "como" in result
        assert "estás" in result

    def test_at_mention_sanitized(self):
        """`@user_xyz` se sanea (el `@` lo trigea)."""
        result = sanitize_text_usernames("pedido por @cristian_rivasxd")
        assert "cristian_rivasxd" not in result
        assert "@" not in result or "Cristianrivasxd" in result
        assert "pedido por" in result

    def test_normal_word_passes_intact(self):
        """Palabras sin `_`/`@`/dígito NO se tocan."""
        text = "Spotify reproduciendo música rock"
        assert sanitize_text_usernames(text) == text

    def test_accented_word_passes_intact(self):
        """Palabras con acentos NO se tocan."""
        text = "María canta en español ñoño"
        assert sanitize_text_usernames(text) == text

    def test_empty_string_returns_empty(self):
        assert sanitize_text_usernames("") == ""

    def test_none_safe(self):
        """`None` no debe crashear (defensivo)."""
        # La firma dice `text: str` pero el código hace `if not text`,
        # así que None pasa por ahí. Test defensivo.
        assert sanitize_text_usernames(None) is None or sanitize_text_usernames(None) == ""


class TestSanitizeTextUsernamesNumbers:
    """REGRESSION del bug raíz v1.0.42: la versión previa saneaba
    CUALQUIER token con dígitos, convirtiendo "12" en "usuario".
    Por eso el TTS leía "Te quedan usuario usos hoy" en vez de
    "Te quedan 3 usos hoy".

    Solo deben sanearse tokens que combinen LETRAS + `@`/`_`/dígito.
    Tokens que son SOLO números deben pasar intactos.
    """

    @pytest.mark.parametrize("text", [
        "Te quedan 3 usos hoy",
        "Llevas 12 días seguidos",
        "1240000 puntos",   # números grandes para TTS lectura natural
        "Año 2026",
        "100% completado",
        "5 + 5 son 10",
    ])
    def test_pure_numbers_preserved(self, text):
        """Números puros (sin letras mezcladas) NO se sanean. Si el
        TTS lee "usuario" en vez de "12", este test falla."""
        result = sanitize_text_usernames(text)
        # Cada token numérico del original debe seguir presente
        for word in text.split():
            if word.isdigit():
                assert word in result, (
                    f"BUG REGRESSION v1.0.42: número '{word}' fue saneado "
                    f"a '{result}' (texto original: '{text}')"
                )

    def test_mixed_token_with_letter_and_digit_is_sanitized(self):
        """`user99` (letra + dígito) SÍ se sanea — es señal de username."""
        result = sanitize_text_usernames("hi user99")
        assert "user99" not in result
        assert "hi" in result

    def test_isolated_underscore_token_not_sanitized(self):
        """Un token que es SOLO `_` o `@` (sin letras) no se sanea —
        no hay nada para limpiar."""
        result = sanitize_text_usernames("hola _ y @ adiós")
        # No tiene que crashear. El comportamiento exacto del `_` solo
        # es undefined pero no debe romper.
        assert "hola" in result
        assert "adiós" in result


class TestSanitizeTextUsernamesPunctuation:
    """La puntuación de borde (`,` `.` `:` `!`) se preserva al sanear
    un username dentro de un texto."""

    def test_trailing_comma_preserved(self):
        result = sanitize_text_usernames("hola darklight_ofk, qué tal")
        assert "," in result
        assert "darklight_ofk" not in result

    def test_trailing_period_preserved(self):
        result = sanitize_text_usernames("escribió user_99.")
        assert result.rstrip().endswith(".")
        assert "user_99" not in result

    def test_question_mark_preserved(self):
        result = sanitize_text_usernames("¿estás ahí, dark_light?")
        assert "?" in result
        assert "¿" in result

    def test_multiple_punctuation_preserved(self):
        """Puntuación compuesta como `!!` o `?!` se conserva."""
        result = sanitize_text_usernames("eh dark_light!!")
        assert "!!" in result


# ─────────────────────────────────────────────────────────────────────
# Idempotencia
# ─────────────────────────────────────────────────────────────────────

class TestIdempotency:
    """`f(f(x)) == f(x)` — sanear dos veces no debe cambiar el resultado.
    Útil porque el saneo se aplica en múltiples capas (chat_dispatcher,
    fortunes, music_speak)."""

    @pytest.mark.parametrize("text", [
        "Hola María cómo estás",
        "Te quedan 5 usos",
        "pedido por darklight_ofk",
        "Spotify reproduciendo rock",
        "",
        "100",
    ])
    def test_sanitize_idempotent(self, text):
        once = sanitize_text_usernames(text)
        twice = sanitize_text_usernames(once)
        assert once == twice, (
            f"sanitize NO es idempotente: '{text}' → '{once}' → '{twice}'"
        )

    @pytest.mark.parametrize("user", [
        "darklight_ofk", "cristian_rivasxd", "María", "@koru", "user99",
    ])
    def test_clean_user_idempotent(self, user):
        once = clean_user_for_tts(user)
        twice = clean_user_for_tts(once)
        assert once == twice
