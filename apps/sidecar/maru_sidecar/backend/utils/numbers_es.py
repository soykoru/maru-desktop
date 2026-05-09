"""Conversor de números a palabras en español (es-ES) para TTS.

Motivación: TikTok TTS lee los dígitos de un número grande UNO POR UNO
("uno-dos-tres-cuatro" en vez de "mil doscientos treinta y cuatro").
Cuando el bot dice "@usuario tiene 1240000 likes" el audio queda
ininteligible. Convertimos a "un millón doscientos cuarenta mil" antes
de mandarlo al TTS.

Implementación standalone (sin dependencias externas como num2words —
crítico para el bundle PyInstaller). Soporta enteros hasta 999_999_999.
Números más grandes se devuelven sin convertir (caen al comportamiento
viejo del TTS).

Reglas españolas relevantes:
  - 16..29 son palabras cerradas: "dieciséis", "veintiuno"...
  - 21..29 con sustantivo masculino: "veintiún" si va seguido de mil/millón.
  - 1: "un" / "uno" / "una" según contexto. Default: "uno".
  - 100 exacto: "cien"; 101..199: "ciento ..."
  - millones: "un millón" (singular), "dos millones" (plural).
  - mil: "mil" (sin "un mil"), "dos mil".

v1.0.69.
"""

from __future__ import annotations

import re
from typing import Iterable

_UNIDADES = {
    0: "cero", 1: "uno", 2: "dos", 3: "tres", 4: "cuatro", 5: "cinco",
    6: "seis", 7: "siete", 8: "ocho", 9: "nueve", 10: "diez",
    11: "once", 12: "doce", 13: "trece", 14: "catorce", 15: "quince",
    16: "dieciséis", 17: "diecisiete", 18: "dieciocho", 19: "diecinueve",
    20: "veinte",
    21: "veintiuno", 22: "veintidós", 23: "veintitrés", 24: "veinticuatro",
    25: "veinticinco", 26: "veintiséis", 27: "veintisiete", 28: "veintiocho",
    29: "veintinueve",
}

_DECENAS = {
    30: "treinta", 40: "cuarenta", 50: "cincuenta", 60: "sesenta",
    70: "setenta", 80: "ochenta", 90: "noventa",
}

_CENTENAS = {
    100: "cien", 200: "doscientos", 300: "trescientos", 400: "cuatrocientos",
    500: "quinientos", 600: "seiscientos", 700: "setecientos",
    800: "ochocientos", 900: "novecientos",
}


def _two_digits_to_words(n: int) -> str:
    """0..99."""
    if n in _UNIDADES:
        return _UNIDADES[n]
    if n in _DECENAS:
        return _DECENAS[n]
    # 31..99 (excluyendo redondos): "treinta y uno", etc.
    decena = (n // 10) * 10
    unidad = n % 10
    return f"{_DECENAS[decena]} y {_UNIDADES[unidad]}"


def _three_digits_to_words(n: int) -> str:
    """0..999."""
    if n == 0:
        return "cero"
    if n < 100:
        return _two_digits_to_words(n)
    if n == 100:
        return "cien"
    centena = (n // 100) * 100
    resto = n % 100
    # Regla española: 100 exacto = "cien"; 101..199 = "ciento ...".
    if centena == 100:
        centena_word = "ciento"
    else:
        centena_word = _CENTENAS[centena]
    if resto == 0:
        return centena_word
    return f"{centena_word} {_two_digits_to_words(resto)}"


def _apocopar_uno(text: str) -> str:
    """Convierte 'uno' final a 'un' cuando precede a mil/millón/millones.
    Ejemplo: 'veintiuno mil' → 'veintiún mil', 'uno millón' → 'un millón'."""
    text = re.sub(r"\buno\b(\s+(?:mil|millón|millones))", r"un\1", text)
    text = re.sub(r"\bveintiuno\b(\s+(?:mil|millón|millones))", r"veintiún\1", text)
    text = re.sub(r"(treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa) y uno\b(\s+(?:mil|millón|millones))", r"\1 y un\2", text)
    return text


def number_to_words_es(n: int) -> str:
    """Convierte un entero positivo a su representación en palabras (español).

    Soporta 0..999_999_999. Fuera de rango devuelve str(n) (caller decide
    qué hacer — típicamente dejar el dígito original al TTS, que aunque
    raro, no rompe el flujo).
    """
    if n < 0 or n > 999_999_999:
        return str(n)
    if n == 0:
        return "cero"
    millones = n // 1_000_000
    miles = (n // 1_000) % 1_000
    resto = n % 1_000
    parts: list[str] = []
    if millones > 0:
        if millones == 1:
            parts.append("un millón")
        else:
            parts.append(f"{_three_digits_to_words(millones)} millones")
    if miles > 0:
        if miles == 1:
            parts.append("mil")
        else:
            parts.append(f"{_three_digits_to_words(miles)} mil")
    if resto > 0:
        parts.append(_three_digits_to_words(resto))
    text = " ".join(parts)
    return _apocopar_uno(text)


# Regex para detectar números enteros embebidos en texto. Captura solo
# secuencias de dígitos rodeadas por word boundary, descartando los que
# están pegados a letras (e.g. "mp3", "v1", "html5") o que tienen
# decimales (los manejamos aparte si fuera necesario).
_INTEGER_RE = re.compile(r"(?<![\w.])(\d{1,9})(?![\w.])")
# Threshold: solo convertimos números de 4+ dígitos (1000+). Los chicos
# (1..999) ya los lee bien el TTS — convertirlos a palabras alarga el
# audio innecesariamente y suena raro ("dije 5" → "dije cinco" sería
# overengineering).
_MIN_DIGITS_TO_CONVERT = 4


def expand_numbers_in_text(text: str) -> str:
    """Reemplaza todos los enteros >=1000 dentro del texto por su forma
    verbal en español. Los números de 1-3 dígitos pasan intactos (el TTS
    ya los lee bien y mantenerlos como dígitos hace el audio más corto).

    Ejemplos:
        "tiene 1240000 likes"   → "tiene un millón doscientos cuarenta mil likes"
        "hoy llegamos a 50000"  → "hoy llegamos a cincuenta mil"
        "te quedan 3 usos"      → "te quedan 3 usos"  (intacto, <1000)
        "Tu suerte es del 87"   → "Tu suerte es del 87"  (intacto, <1000)

    Edge cases:
        - Números pegados a letras (mp3, html5) → NO se tocan.
        - Decimales con punto (3.14) → NO se tocan (regex excluye).
        - Números separados por comas (1,000) → cada parte se evalúa
          individualmente; "1,000" deja "1,000" porque cada lado tiene
          <4 dígitos.
        - Negativos → no se manejan (no hay caso de uso en bot MARU).
    """
    if not text:
        return text

    def _repl(match: "re.Match[str]") -> str:
        token = match.group(1)
        if len(token) < _MIN_DIGITS_TO_CONVERT:
            return token
        try:
            n = int(token)
        except ValueError:
            return token
        return number_to_words_es(n)

    return _INTEGER_RE.sub(_repl, text)
