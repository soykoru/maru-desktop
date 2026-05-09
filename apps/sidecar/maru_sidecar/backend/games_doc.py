"""Servicio `games-doc.*` — Genera la documentación maestra de cómo
conectar juegos a MARU.

Returna un Markdown completo y autocontenido que el user puede:
  - Descargar para referencia.
  - Pegar a una IA (ChatGPT, Claude, Gemini) para que le genere el
    mod específico del juego que quiere integrar.
  - Compartir con devs que vayan a hacer mods compatibles.

El contenido se genera dinámicamente para reflejar el estado real del
sistema (juegos integrados, defaults, etc.) — NO es un texto estático.

v1.0.71.
"""

from __future__ import annotations

import time
from typing import Any

from ..logger import get_logger

log = get_logger(__name__)


def _build_doc(games_list: list[dict[str, Any]]) -> str:
    """Construye el MD completo basado en los juegos actualmente
    registrados en el GamesService."""
    standards = [g for g in games_list if g.get("isStandard")]
    customs = [g for g in games_list if not g.get("isStandard")]
    now = time.strftime("%Y-%m-%d %H:%M")

    sections: list[str] = []

    # Header
    sections.append(f"""# 🎮 MARU Live — Documentación de Integración con Juegos

> Generado automáticamente desde MARU el {now}.
> Versión del sistema: contrato `v2`.

Este documento explica cómo MARU se conecta con juegos, qué necesita un juego para ser controlado por MARU, y cómo agregar juegos nuevos (con o sin programar).

**Si estás leyendo esto porque querés que una IA te haga un mod compatible con MARU**: copiá este archivo entero y pegáselo a la IA con el prompt "Necesito un mod para el juego X que implemente este contrato HTTP". La IA va a tener TODO lo que necesita saber.

---

## 📑 Índice

1. [Arquitectura general](#1-arquitectura-general)
2. [Cómo se conecta MARU a un juego](#2-cómo-se-conecta-maru-a-un-juego)
3. [Contrato HTTP del mod](#3-contrato-http-del-mod)
4. [Contrato RCON](#4-contrato-rcon)
5. [Juegos actualmente integrados](#5-juegos-actualmente-integrados)
6. [Cómo agregar un juego nuevo (sin programar)](#6-cómo-agregar-un-juego-nuevo-sin-programar)
7. [Cómo agregar un juego nuevo (programando un mod)](#7-cómo-agregar-un-juego-nuevo-programando-un-mod)
8. [Plantilla de mod en C# / BepInEx (Unity)](#8-plantilla-de-mod-en-c--bepinex-unity)
9. [Plantilla de mod en Java (Spigot/Paper)](#9-plantilla-de-mod-en-java-spigotpaper)
10. [Sistema de reglas y eventos disponibles](#10-sistema-de-reglas-y-eventos-disponibles)
11. [Datos: entidades, items, eventos](#11-datos-entidades-items-eventos)
12. [FAQ y troubleshooting](#12-faq-y-troubleshooting)
13. [Recursos para IAs](#13-recursos-para-ias)

---

## 1. Arquitectura general

MARU es una aplicación de escritorio que conecta eventos de TikTok Live (regalos, likes, follows, comentarios, comandos del chat) con acciones en videojuegos (spawnear enemigos, dar items, ejecutar eventos).

```
┌──────────────────────────┐
│  TikTok Live (WebSocket) │
└────────────┬─────────────┘
             │ eventos crudos (gift, like, follow, comment...)
             ▼
┌──────────────────────────┐
│      MARU Live           │
│  ┌────────────────────┐  │
│  │  Rule Engine       │  │ ← reglas configurables: "si gift X → spawn Y"
│  └─────────┬──────────┘  │
│            │             │
│  ┌─────────▼──────────┐  │
│  │  Game Adapter      │  │
│  └─────────┬──────────┘  │
└────────────┼─────────────┘
             │ HTTP POST o RCON
             ▼
┌──────────────────────────┐
│  Tu juego (con mod)      │
│  - Recibe la acción      │
│  - La ejecuta in-game    │
└──────────────────────────┘
```

**Flujo de una donación**:
1. Viewer envía un regalo "🌹 rosa" en TikTok.
2. MARU recibe el evento del WebSocket de TikTok.
3. El Rule Engine matchea contra las reglas del usuario: "si recibo 'rosa' → spawnear Troll en Valheim".
4. MARU resuelve la acción: "POST a `http://localhost:5000/spawn` con body `{{\"entity_name\": \"Troll\", \"amount\": 1}}`".
5. El mod del juego escucha en ese puerto, recibe el JSON, y spawnea el Troll cerca del jugador.

---

## 2. Cómo se conecta MARU a un juego

MARU soporta DOS tipos de conexión:

### 2.1 HTTP (recomendado para la mayoría)

El juego corre un **servidor HTTP local** (típicamente en `127.0.0.1:5000`) que escucha POST requests con JSON.

**Ventajas**:
- Funciona con cualquier engine (Unity, Unreal, Java, custom).
- Cualquier IA puede generar el mod en minutos.
- Fácil de debuggear (curl, Postman).
- No hay protocolo binario — solo JSON.

**Desventajas**:
- Requiere que el juego tenga capacidad de hacer mods (BepInEx, Forge, SMAPI, etc.) o que ya exponga una API HTTP nativa.

### 2.2 RCON (para juegos con consola remota nativa)

El juego ya viene con servidor RCON activable (Minecraft, todos los Source Engine, ARK, Rust, Project Zomboid, Factorio, Palworld).

**Ventajas**:
- **Cero mod necesario** — solo activar RCON en el config del server.
- Comandos crudos del juego (los mismos que escribirías en la consola).

**Desventajas**:
- Limitado a comandos que ya soporta el juego.
- El usuario debe poner password del RCON en MARU.

### 2.3 ¿Cuál elegir?

| Tu juego tiene... | Usá |
|-------------------|-----|
| RCON nativo (Minecraft, Palworld, Source...) | RCON |
| Mod loader maduro (BepInEx, SMAPI, tModLoader, Forge...) | HTTP con mod custom |
| API REST oficial (Palworld v0.2+, etc.) | HTTP nativo |
| Nada de lo anterior | No es viable integrar |

---

## 3. Contrato HTTP del mod

Esta es la parte más importante. Si tu mod implementa este contrato, MARU lo va a poder controlar **sin cambiar nada en MARU**.

### 3.1 Especificación del servidor

- **Bind address**: `127.0.0.1` (NUNCA `localhost` — algunos sistemas resuelven a IPv6 y rompen).
- **Puerto**: configurable por el usuario, default `5000`.
- **Method**: `POST`.
- **Content-Type**: `application/json`.
- **Status code de éxito**: `200 OK`. Cualquier otro código se considera error.
- **Status code de error**: `400` si el payload es inválido, `404` si la entidad/item no existe, `500` si el juego no pudo ejecutar.
- **Auth**: ninguna. MARU asume `127.0.0.1` (loopback) por seguridad.
- **Timeout del cliente**: 0.5 segundos (fire-and-forget). El mod debe responder rápido.

### 3.2 Endpoints estándar

#### `POST /spawn` — Spawnear una entidad

Request body:
```json
{{
  "entity_name": "Troll",
  "amount": 3
}}
```

Response esperada: `200 OK` (body opcional).

#### `POST /spawn` con type=item — Dar un item al inventario

Request body:
```json
{{
  "entity_name": "SwordIron",
  "amount": 1,
  "type": "item"
}}
```

#### `POST /spawn` con type=valuable — Dar un objeto de valor

Request body:
```json
{{
  "entity_name": "Diamond",
  "amount": 1,
  "type": "valuable"
}}
```

#### `POST /event` — Disparar un evento

Request body:
```json
{{
  "event_name": "kill_all_enemies",
  "value": 1
}}
```

`value` puede ser número o string vacío.

### 3.3 Endpoint alternativo: single endpoint

Si preferís un solo endpoint que distinga por payload, MARU también lo soporta:

```
POST /
Content-Type: application/json

{{ "entity_name": "Troll", "amount": 3 }}                 ← spawn entidad
{{ "entity_name": "Sword", "amount": 1, "type": "item" }} ← item
{{ "entity_name": "Gold", "amount": 5, "type": "valuable" }} ← valuable
{{ "command": "horde", "value": "5" }}                    ← evento/comando
```

El mod detecta el tipo de acción mirando qué keys tiene el JSON:
- Tiene `command` → es un evento/comando.
- Tiene `entity_name` + `type=valuable` → es un valuable.
- Tiene `entity_name` + `type=item` → es un item.
- Tiene `entity_name` (sin `type` o `type=entity`) → es un spawn de entidad.

### 3.4 Endpoint de healthcheck (opcional pero recomendado)

```
GET /status
```

Response esperada: `200 OK` con body opcional `{{"ok": true, "game": "Valheim"}}`.

MARU lo llama cuando el usuario clickea "Probar conexión".

### 3.5 Comportamiento ante errores

- Si el mod **no responde** en 500ms → MARU loguea el intento como exitoso pero la acción no ocurre. (Limitación conocida — fire-and-forget para no bloquear el live con 50+ events/segundo.)
- Si el mod responde **`200`** → MARU asume éxito.
- Si el mod responde **`400/404/500`** → MARU loguea el error pero no reintenta.
- **MARU NO hace retry**. El mod debe ser idempotente y robusto.

---

## 4. Contrato RCON

Para juegos con RCON nativo, MARU usa el protocolo Source RCON estándar (TCP).

### 4.1 Configuración del usuario

En MARU, el usuario configura:
- **Host**: típicamente `localhost` o IP del servidor.
- **Port**: default `25575` (Minecraft), pero varía por juego.
- **Password**: la del RCON del server.

### 4.2 Cómo MARU usa RCON

MARU NO transforma comandos. Lo que el usuario escribe en MARU como "comando" se ejecuta tal cual en la consola del juego.

Ejemplos:
- Minecraft: `summon zombie ~ ~ ~`, `give @p diamond 64`, `weather thunder`.
- Source Engine: `give weapon_ak47`, `mp_warmup_end`, `bot_kick`.
- ARK: `summon Ptero_Character_BP_C`, `giveitem PrimalItem_WeaponMetalSword`.
- Palworld: `Broadcast Hello`, `KickPlayer SteamID`.

### 4.3 Variables disponibles en comandos

MARU reemplaza estos placeholders antes de enviar:
- `{{user}}` o `{{username}}` → nombre del viewer que disparó la acción.

Ejemplo: `tellraw @a {{"text":"Bienvenido {{user}}!"}}`.

### 4.4 Multi-comando

Comandos separados por `\\n` (newline) se ejecutan secuencialmente.

---

## 5. Juegos actualmente integrados

### 5.1 Predefinidos (vienen con MARU)
""")

    # Standards
    if standards:
        sections.append("\n| Juego | Tipo | Default | Necesita mod |\n|-------|------|---------|-------------|")
        for g in standards:
            conn = g.get("connection") or {}
            host = conn.get("host", "—")
            port = conn.get("port", "—")
            ctype = (g.get("connectionType") or "http").upper()
            needs_mod = "❌ No (RCON nativo)" if ctype == "RCON" else "✅ Sí"
            sections.append(f"| {g.get('icon','')} **{g.get('name','?')}** | {ctype} | `{host}:{port}` | {needs_mod} |")
    else:
        sections.append("\n_(Sin juegos predefinidos cargados aún.)_")

    sections.append("""
### 5.2 Customs (creados por el usuario)
""")

    if customs:
        sections.append("| Juego | Tipo | Default | Categorías |\n|-------|------|---------|------------|")
        for g in customs:
            conn = g.get("connection") or {}
            host = conn.get("host", "—")
            port = conn.get("port", "—")
            ctype = (g.get("connectionType") or "http").upper()
            cats = g.get("categories") or []
            cat_names = ", ".join(c.get("name", c.get("id", "?")) for c in cats) or "—"
            sections.append(f"| {g.get('icon','')} **{g.get('name','?')}** | {ctype} | `{host}:{port}` | {cat_names} |")
    else:
        sections.append("_(El usuario aún no ha creado ningún juego custom.)_")

    sections.append("""

---

## 6. Cómo agregar un juego nuevo (sin programar)

Si el juego ya tiene RCON nativo o una API HTTP que cumpla el contrato de MARU, podés agregarlo SIN escribir código:

1. Abrí MARU → 🎮 **Perfiles de Juegos**.
2. Click en **Añadir Juego (API/RCON)**.
3. Configurá:
   - **Nombre** del juego.
   - **Icono** (emoji).
   - **Tipo de conexión**: HTTP o RCON.
   - **Host** y **Puerto**.
   - Si es RCON, la **password**.
   - Las **categorías** (entidades, items, eventos, valuables — las que correspondan).
4. Para cada categoría, configurá:
   - **Endpoint** (HTTP) o **comando RCON**.
   - **Template del payload** con placeholders `{{entity}}`, `{{amount}}`, `{{user}}`, `{{value}}`.
   - **Tutorial** (texto que aparece como ayuda al editar entidades de esa categoría).
5. Guardá. El juego aparece como custom.
6. Andá a **Datos** del juego y agregá las entidades, items, eventos que querés controlar (formato `NombreVisible:ComandoInterno`).
7. Andá a **Reglas** y configurá qué evento de TikTok dispara qué acción.

**Listo**. No tocaste código.

---

## 7. Cómo agregar un juego nuevo (programando un mod)

Si el juego NO tiene RCON nativo y NO expone API HTTP, vas a necesitar crear un mod que escuche en un puerto local.

### 7.1 Pasos generales

1. **Identificá el mod loader del juego**:
   - Unity (Valheim, Lethal Company, R.E.P.O., Content Warning, Risk of Rain 2): **BepInEx**.
   - Minecraft Java vanilla: **NO necesitás mod** (usá RCON).
   - Minecraft Modded: **Forge** o **Fabric**.
   - Stardew Valley: **SMAPI**.
   - Skyrim/Fallout: **SKSE/F4SE**.
   - Cities Skylines: **Harmony**.
   - Don't Starve Together: **Klei Lua mods**.

2. **Creá el mod** que en su `Awake()` o equivalente arranque un servidor HTTP en `127.0.0.1:5000` (puerto configurable).

3. **Implementá los endpoints** según el contrato de la sección 3.

4. **Probá con `curl`** que el servidor responde:
   ```
   curl -X POST http://127.0.0.1:5000/spawn -H "Content-Type: application/json" -d "{{\\"entity_name\\":\\"Zombie\\",\\"amount\\":1}}"
   ```

5. **Configurá el juego en MARU** como custom HTTP, port 5000.

6. **Listo**. Las acciones llegan al mod.

### 7.2 Consideraciones por engine

**Unity (BepInEx)**:
- El servidor HTTP debe correr en un thread separado.
- Las acciones in-game (spawn, give item) deben ejecutarse en el **main thread** (Unity es single-threaded para la lógica de juego). Patrón: cola `ConcurrentQueue<Action>` consumida en `Update()`.
- Usar `System.Net.HttpListener` (incluido en .NET).

**Minecraft Forge/Fabric**:
- Los mods cargan en bootstrap del server.
- Spigot/Paper plugins corren en el main thread del server — usar `Bukkit.getScheduler().runTask(plugin, () -> ...)`.

**SMAPI (Stardew Valley)**:
- Hooks oficiales: `Game1.player.addItemToInventoryBool(...)`, `Game1.timeOfDay = 600`.
- HTTP server en thread separado pero acciones en `Game1.tickActions.Add(...)`.

---

## 8. Plantilla de mod en C# / BepInEx (Unity)

Esta plantilla funciona para **cualquier juego Unity con BepInEx**. Cambiá los stubs `SpawnEntity()`, `GiveItem()`, `TriggerEvent()` con la API real del juego.

```csharp
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using BepInEx;
using HarmonyLib;
using UnityEngine;

[BepInPlugin("com.maru.bridge", "MARU Bridge", "1.0.0")]
public class MaruBridge : BaseUnityPlugin
{{
    private HttpListener _listener;
    private Thread _listenerThread;
    private readonly ConcurrentQueue<Action> _mainThreadActions = new();

    private const int PORT = 5000;

    void Awake()
    {{
        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://127.0.0.1:{{PORT}}/");
        _listener.Start();

        _listenerThread = new Thread(ListenLoop) {{ IsBackground = true }};
        _listenerThread.Start();

        Logger.LogInfo($"MARU Bridge escuchando en http://127.0.0.1:{{PORT}}/");
    }}

    void Update()
    {{
        // Procesa acciones en el main thread (Unity single-threaded para
        // operaciones del juego como Instantiate, GameObject manipulation, etc).
        while (_mainThreadActions.TryDequeue(out var action))
        {{
            try {{ action(); }}
            catch (Exception e) {{ Logger.LogError($"Action error: {{e}}"); }}
        }}
    }}

    private void ListenLoop()
    {{
        while (_listener.IsListening)
        {{
            HttpListenerContext ctx;
            try {{ ctx = _listener.GetContext(); }}
            catch {{ break; }}

            string path = ctx.Request.Url.AbsolutePath.TrimEnd('/');
            string body;
            using (var sr = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
                body = sr.ReadToEnd();

            // Parse JSON con SimpleJSON, Newtonsoft, o manual con string.Split.
            // Acá uso parsing manual para no depender de libs externas.
            string entityName = ExtractJsonString(body, "entity_name");
            int amount = ExtractJsonInt(body, "amount", 1);
            string type = ExtractJsonString(body, "type") ?? "entity";
            string command = ExtractJsonString(body, "command");
            string value = ExtractJsonString(body, "value");

            Action action = null;

            if (!string.IsNullOrEmpty(command))
            {{
                action = () => TriggerEvent(command, value);
            }}
            else if (type == "item")
            {{
                action = () => GiveItem(entityName, amount);
            }}
            else if (type == "valuable")
            {{
                action = () => GiveValuable(entityName, amount);
            }}
            else if (!string.IsNullOrEmpty(entityName))
            {{
                action = () => SpawnEntity(entityName, amount);
            }}

            if (action != null) _mainThreadActions.Enqueue(action);

            byte[] response = Encoding.UTF8.GetBytes("{{\\"ok\\":true}}");
            ctx.Response.ContentType = "application/json";
            ctx.Response.StatusCode = 200;
            ctx.Response.OutputStream.Write(response, 0, response.Length);
            ctx.Response.Close();
        }}
    }}

    // ───── Stubs para que vos completes con la API real del juego ─────

    private void SpawnEntity(string name, int amount)
    {{
        // Ejemplo Valheim:
        // var prefab = ZNetScene.instance.GetPrefab(name);
        // for (int i = 0; i < amount; i++)
        //   Instantiate(prefab, GetPlayerPosition(), Quaternion.identity);
        Logger.LogInfo($"SPAWN {{amount}}x {{name}}");
    }}

    private void GiveItem(string name, int amount)
    {{
        Logger.LogInfo($"GIVE_ITEM {{amount}}x {{name}}");
    }}

    private void GiveValuable(string name, int amount)
    {{
        Logger.LogInfo($"GIVE_VALUABLE {{amount}}x {{name}}");
    }}

    private void TriggerEvent(string command, string value)
    {{
        Logger.LogInfo($"EVENT {{command}} value={{value}}");
    }}

    // ───── Helpers de parseo manual de JSON ─────

    private static string ExtractJsonString(string json, string key)
    {{
        int idx = json.IndexOf("\\"" + key + "\\"");
        if (idx < 0) return null;
        idx = json.IndexOf(':', idx) + 1;
        while (idx < json.Length && char.IsWhiteSpace(json[idx])) idx++;
        if (idx >= json.Length) return null;
        if (json[idx] == '"')
        {{
            int end = json.IndexOf('"', idx + 1);
            return end < 0 ? null : json.Substring(idx + 1, end - idx - 1);
        }}
        return null;
    }}

    private static int ExtractJsonInt(string json, string key, int def)
    {{
        int idx = json.IndexOf("\\"" + key + "\\"");
        if (idx < 0) return def;
        idx = json.IndexOf(':', idx) + 1;
        while (idx < json.Length && char.IsWhiteSpace(json[idx])) idx++;
        int start = idx;
        while (idx < json.Length && (char.IsDigit(json[idx]) || json[idx] == '-')) idx++;
        return int.TryParse(json.Substring(start, idx - start), out var n) ? n : def;
    }}
}}
```

### 8.1 Cómo compilar y empaquetar

1. Crear proyecto C# .NET Framework 4.7.2 (estándar BepInEx para Unity 2018+).
2. Referencias: `BepInEx.dll`, `0Harmony.dll`, `UnityEngine.CoreModule.dll`, `Assembly-CSharp.dll` (del juego target).
3. Build → DLL.
4. Copiar la DLL a `<juego>/BepInEx/plugins/`.
5. Iniciar el juego — el log de BepInEx debe mostrar "MARU Bridge escuchando en http://127.0.0.1:5000/".

---

## 9. Plantilla de mod en Java (Spigot/Paper)

Para Minecraft modded sin RCON. Para vanilla, **usá RCON** (no necesitás mod).

```java
package com.maru.bridge;

import com.sun.net.httpserver.HttpServer;
import org.bukkit.Bukkit;
import org.bukkit.entity.EntityType;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

public class MaruBridge extends JavaPlugin {{

    private HttpServer server;

    @Override
    public void onEnable() {{
        try {{
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 5000), 0);
            server.createContext("/spawn", exchange -> {{
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                String entity = extractJsonString(body, "entity_name");
                int amount = extractJsonInt(body, "amount", 1);

                // Ejecutar en main thread del server (Bukkit es single-threaded)
                Bukkit.getScheduler().runTask(this, () -> {{
                    var player = Bukkit.getOnlinePlayers().stream().findFirst().orElse(null);
                    if (player == null) return;
                    EntityType type = EntityType.valueOf(entity.toUpperCase());
                    for (int i = 0; i < amount; i++) {{
                        player.getWorld().spawnEntity(player.getLocation(), type);
                    }}
                }});

                byte[] resp = "{{\\"ok\\":true}}".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, resp.length);
                try (OutputStream os = exchange.getResponseBody()) {{
                    os.write(resp);
                }}
            }});
            server.start();
            getLogger().info("MARU Bridge escuchando en http://127.0.0.1:5000/");
        }} catch (IOException e) {{
            getLogger().severe("MARU Bridge no pudo arrancar: " + e.getMessage());
        }}
    }}

    @Override
    public void onDisable() {{
        if (server != null) server.stop(0);
    }}

    private static String extractJsonString(String json, String key) {{
        // Implementar parseo simple o usar Gson/Jackson
        // ...
        return null;
    }}

    private static int extractJsonInt(String json, String key, int def) {{
        return def;
    }}
}}
```

---

## 10. Sistema de reglas y eventos disponibles

MARU tiene un Rule Engine que matchea **eventos de TikTok** contra reglas configurables. Cada regla tiene:

- **Trigger**: qué evento la dispara.
- **Action**: qué hacer en el juego.

### 10.1 Triggers (eventos de TikTok)

| Trigger | Cuándo dispara |
|---------|---------------|
| `gift` | Cuando un viewer regala un gift específico (rosa, león, etc.). |
| `like` | Cuando llega un batch de likes (ej. cada 100 likes). |
| `like_milestone` | Cuando se alcanza un total acumulado de likes. |
| `follow` | Cuando alguien follows el live. |
| `share` | Cuando alguien comparte el live. |
| `comment` | Cuando alguien comenta texto. |
| `command` | Cuando alguien escribe un comando como `!play`, `!attack`. |
| `emote` | Cuando alguien manda un emote/sticker grande. |
| `join` | Cuando alguien entra al live. |
| `repeat_for` | Cuando un user dona N veces seguidas (para "raids" del mismo gift). |

### 10.2 Actions (qué hacer en el juego)

| Action | Cómo MARU lo manda al mod |
|--------|--------------------------|
| `spawn` | `POST /spawn` con `{{entity_name, amount}}`. |
| `give_item` | `POST /spawn` con `{{entity_name, amount, type:"item"}}`. |
| `spawn_valuable` | `POST /spawn` con `{{entity_name, amount, type:"valuable"}}`. |
| `trigger_event` | `POST /event` con `{{event_name, value}}`. |
| `multi-action` | Una regla puede tener múltiples actions que se ejecutan todas. |
| `random` | Selecciona 1 action al azar de la lista. |

### 10.3 Filtros por rol

Cada regla puede filtrar por rol del viewer:
- `super_fan`: solo fans del fans club.
- `mod`: moderadores.
- `follower`: que sigan al canal.
- `member`: con `member_level` en un rango.
- `donor`: con `gifter_level` en un rango.

### 10.4 Boosts (multiplicadores acumulables)

El usuario puede crear "boosts" externos que multiplican el `trigger_times` de las reglas para usuarios con cierto rol. Ejemplo: "super fans reciben x3 ejecuciones de cada regla". Acumulan multiplicativamente (`super_fan x3` * `mod x2` = x6).

---

## 11. Datos: entidades, items, eventos

Cada juego tiene su catálogo de entidades/items/eventos en `data_<gameId>.json`.

Formato:
```json
{{
  "entities": [
    {{ "name": "Troll Furioso", "command": "Troll" }},
    {{ "name": "Lobo", "command": "Wolf" }}
  ],
  "items": [
    {{ "name": "Espada Hierro", "command": "SwordIron" }}
  ],
  "events": [
    {{ "name": "Matar a todos", "command": "kill_all_enemies" }}
  ]
}}
```

- **`name`**: lo que el usuario ve en la UI.
- **`command`**: lo que se manda al mod (en `entity_name` o `command` del payload).

---

## 12. FAQ y troubleshooting

### "MARU dice que no se conecta"
- Verificá que el mod esté instalado y el juego corriendo.
- Probá `curl http://127.0.0.1:5000/status` desde una terminal.
- Confirmá host = `127.0.0.1` (NO `localhost`) en MARU.
- Verificá que ningún firewall esté bloqueando el puerto.

### "El mod recibe los requests pero el juego no hace nada"
- Asegurate de ejecutar las acciones en el **main thread** del juego.
- En Unity: usar `ConcurrentQueue<Action>` consumida en `Update()`.
- En Bukkit/Spigot: usar `Bukkit.getScheduler().runTask(...)`.

### "Llegan demasiados eventos y el juego lagea"
- MARU manda fire-and-forget (timeout 0.5s). El mod no debe bloquear.
- En el mod, considera agregar rate limiting (max 10 spawns/segundo).
- Usar el campo `cooldown` de las reglas en MARU para limitar frecuencia.

### "¿Puedo agregar el juego sin programar?"
- Sí, si el juego tiene RCON nativo (Minecraft, Source, ARK, Rust, Palworld, Factorio, etc).
- Sí, si el juego ya expone una API HTTP REST.
- No, si necesitás efectos in-game custom — ahí sí necesitás un mod.

---

## 13. Recursos para IAs

Si vas a pegar este documento a una IA (ChatGPT, Claude, Gemini, etc.) para que te genere un mod específico:

**Prompt sugerido**:
> Necesito un mod para el juego **{{NOMBRE_DEL_JUEGO}}** que implemente el contrato HTTP de MARU Live (descrito en el documento adjunto). El mod debe:
> 1. Correr un servidor HTTP en `127.0.0.1:5000`.
> 2. Aceptar `POST /spawn` con `{{entity_name, amount, type?}}` y spawnear la entidad / dar el item según `type`.
> 3. Aceptar `POST /event` con `{{event_name, value}}` y ejecutar el evento.
> 4. Responder `200 OK` rápido (timeout MARU es 500ms).
> 5. Las acciones in-game deben ejecutarse en el main thread del juego.
>
> Usá el mod loader **{{MOD_LOADER}}** ({{BepInEx | Forge | SMAPI | etc.}}).
> Generame el código completo y compilable, con comentarios y referencias a las APIs reales del juego.

**Archivos relevantes en MARU** (para que la IA tenga referencia):
- Plantilla C# / BepInEx: ver sección 8.
- Plantilla Java / Spigot: ver sección 9.
- Contrato HTTP: ver sección 3.

---

> **Generado por MARU Live — sistema de integración con juegos.**
> Si encontrás algún error o querés mejorar este doc, abrí un issue en https://github.com/soykoru/maru-desktop
""")

    return "\n".join(sections)


class GamesDocService:
    """Servicio que expone el RPC `games-doc.get` para que el frontend
    descargue la documentación maestra como string Markdown."""

    def __init__(self) -> None:
        self._games_svc: Any = None

    def attach_games(self, games_svc: Any) -> None:
        """Inyectado por el registry para leer juegos actualmente cargados."""
        self._games_svc = games_svc

    def get(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve `{markdown, filename}` con la documentación generada
        dinámicamente reflejando el estado actual de juegos en MARU."""
        games_list: list[dict[str, Any]] = []
        if self._games_svc is not None and hasattr(self._games_svc, "list"):
            try:
                res = self._games_svc.list({})
                games_list = list(res.get("games") or [])
            except Exception:
                log.exception("games_doc: no pude leer games.list")
        markdown = _build_doc(games_list)
        return {
            "markdown": markdown,
            "filename": f"MARU-Documentacion-Juegos-{time.strftime('%Y%m%d')}.md",
            "bytes": len(markdown.encode("utf-8")),
        }
