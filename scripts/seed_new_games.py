"""Agregar 6 perfiles de juegos nuevos al seed bundle de MARU.

Lee `apps/desktop/resources/data/games.json` (formato MARU original con
`custom_games` + `game_configs`), inserta los nuevos perfiles si no existen
ya, y reescribe el archivo. Idempotente: correrlo 2 veces no duplica nada.

Juegos agregados (v1.0.72):
  - Palworld          → REST API nativa con Basic Auth, anuncios oficiales
  - ARK Survival Ascended → RCON, spawn dinos + give items
  - Project Zomboid   → RCON, additem + createhorde + clima
  - ICARUS            → RCON, AdminSay + moderación
  - Green Hell        → HTTP placeholder (requiere mod BepInEx por hacer)
  - Core Keeper       → HTTP placeholder (requiere mod BepInEx por hacer)

Uso: python scripts/seed_new_games.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAMES_JSON = ROOT / "apps" / "desktop" / "resources" / "data" / "games.json"


def palworld_profile() -> dict:
    return {
        "id": "palworld",
        "name": "Palworld",
        "icon": "🐉",
        "host": "127.0.0.1",
        "port": 8212,
        "connection_type": "http",
        "has_entities": False,
        "has_items": False,
        "has_events": True,
        "http_method": "POST",
        "cover_image": "palworld.jpg",
        "requires_mod": False,
        "categories": [
            {
                "id": "events",
                "name": "📢 Anuncios y Moderación",
                "type": "event",
                "icon": "📢",
                "data_key": "events",
                "endpoint": "/v1/api/announce",
                "payload": "{\"message\": \"{value}\"}",
                "rcon_cmd": "",
                "tutorial": "📝 PALWORLD - ANUNCIOS Y MODERACIÓN\n\n🔌 CONFIGURACIÓN:\nEn PalWorldSettings.ini activá:\n  RESTAPIEnabled=True\n  RESTAPIPort=8212\n  AdminPassword=\"tu-password\"\n\n🔐 AUTH:\nUsá el editor de juego custom para configurar Basic Auth con:\n  Usuario: admin\n  Password: tu admin password\n\n📢 EVENTOS DISPONIBLES (REST oficial):\n• Anuncio:announce → POST /v1/api/announce\n• Kick:kick → kicks player by SteamID\n• Ban:ban → bans player\n• Save:save → guarda mundo\n• Shutdown:shutdown → apaga server\n\n💡 USO desde reglas:\nFormato: Nombre Visible:comando:valor\nEjemplo: Saludar:announce:Bienvenido al stream\n\n⚠️ NO incluye spawn de pals/give items en REST oficial.\nPara eso requiere el mod 'Admin Commands' de NexusMods."
            }
        ],
        "spawn_endpoint": "/v1/api/announce",
        "item_endpoint": "/v1/api/announce",
        "event_endpoint": "/v1/api/announce",
        "spawn_payload": "{\"message\": \"spawn {entity}\"}",
        "item_payload": "{\"message\": \"give {entity} {amount}\"}",
        "event_payload": "{\"message\": \"{value}\"}",
        "rcon_spawn_cmd": "",
        "rcon_item_cmd": "",
        "rcon_event_cmd": "",
    }


def ark_ascended_profile() -> dict:
    return {
        "id": "ark_ascended",
        "name": "ARK: Survival Ascended",
        "icon": "🦖",
        "host": "127.0.0.1",
        "port": 27020,
        "connection_type": "rcon",
        "has_entities": True,
        "has_items": True,
        "has_events": True,
        "cover_image": "ark_ascended.jpg",
        "requires_mod": False,
        "categories": [
            {
                "id": "entities",
                "name": "🦖 Dinosaurios",
                "type": "entity",
                "icon": "🦖",
                "data_key": "entities",
                "endpoint": "",
                "payload": "",
                "rcon_cmd": "summon {entity}",
                "tutorial": "📝 ARK: SURVIVAL ASCENDED - DINOSAURIOS\n\n🔌 CONFIGURACIÓN RCON:\nEn GameUserSettings.ini:\n  RCONEnabled=True\n  RCONPort=27020\n  ServerAdminPassword=\"tu-password\"\n\n🦖 SPAWN DE CRIATURAS:\nFormato: NombreVisible:Blueprint_Name\n\nEjemplos comunes:\n• Rex:Rex_Character_BP_C\n• Argentavis:Argent_Character_BP_C\n• Raptor:Raptor_Character_BP_C\n• Carno:Carno_Character_BP_C\n• Giga:Gigant_Character_BP_C\n• Spino:Spino_Character_BP_C\n• Trike:Trike_Character_BP_C\n• Stego:Stego_Character_BP_C\n\n🐺 VARIANTES TAMED:\nUsá el comando 'tamed' en eventos para SummonTamed\n\n⚠️ Los blueprints son LARGOS pero exactos.\nVer wiki: ark.fandom.com/wiki/Console_commands"
            },
            {
                "id": "items",
                "name": "📦 Items / Recursos",
                "type": "item",
                "icon": "📦",
                "data_key": "items",
                "endpoint": "",
                "payload": "",
                "rcon_cmd": "GiveItem \"{entity}\" {amount} 1 0",
                "tutorial": "📝 ARK: SURVIVAL ASCENDED - ITEMS\n\n🎒 GIVEITEM SINTAXIS:\n  GiveItem \"<blueprint>\" <quantity> <quality> <forceBP>\n\nEjemplos:\n• Espada Metal:Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Weapons/PrimalItem_WeaponMetalSword.PrimalItem_WeaponMetalSword'\n• Carne:Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItem_ConsumableCookedMeat.PrimalItem_ConsumableCookedMeat'\n• Madera:Blueprint'/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_Wood.PrimalItemResource_Wood'\n\n💡 ALTERNATIVA: GiveItemNum\nMás corto pero requiere ID numérico.\nEj: GiveItemNum 1 1 1 false\n\n⚠️ Lista completa: ark.wiki.gg/wiki/Item_IDs"
            },
            {
                "id": "events",
                "name": "⚡ Comandos / Cheats",
                "type": "event",
                "icon": "⚡",
                "data_key": "events",
                "endpoint": "",
                "payload": "",
                "rcon_cmd": "{command}",
                "tutorial": "📝 ARK: SURVIVAL ASCENDED - COMANDOS\n\n💀 VIDA / GOD MODE:\n• God:god\n• Inmortal Stats:Infinitestats\n• Solo me ven dinos pacíficos:LeaveMeAlone\n• Reset Stats:Suicide\n\n🦖 INTERACCIÓN CON DINOS:\n• Tamear el que mira:Forcetame\n• Domar al instante:DoTame\n• Hacer Dodo bebé:CE\n• Volar:Fly\n• Caminar normal:Walk\n• God dino:DestroyMyTarget\n\n⚡ CAOS / EVENTOS:\n• Tormenta:CE Storm\n• Lluvia:CE Rain\n• Día:settimeofday 12:00\n• Noche:settimeofday 00:00\n• Velocidad x2:settimeofday 23:59\n\n🎁 EXPERIENCIA:\n• XP +1000:GiveExperience 1000 0 0\n• Engrams:GiveEngrams\n\n⚠️ Algunos comandos requieren EnableCheats antes."
            }
        ],
        "spawn_endpoint": "",
        "item_endpoint": "",
        "event_endpoint": "",
        "spawn_payload": "",
        "item_payload": "",
        "event_payload": "",
        "rcon_spawn_cmd": "summon {entity}",
        "rcon_item_cmd": "GiveItem \"{entity}\" {amount} 1 0",
        "rcon_event_cmd": "{command}",
    }


def project_zomboid_profile() -> dict:
    return {
        "id": "project_zomboid",
        "name": "Project Zomboid",
        "icon": "🧟",
        "host": "127.0.0.1",
        "port": 27015,
        "connection_type": "rcon",
        "has_entities": True,
        "has_items": True,
        "has_events": True,
        "cover_image": "project_zomboid.jpg",
        "requires_mod": False,
        "categories": [
            {
                "id": "entities",
                "name": "🧟 Hordas Zombie",
                "type": "entity",
                "icon": "🧟",
                "data_key": "entities",
                "endpoint": "",
                "payload": "",
                "rcon_cmd": "createhorde {amount} \"{user}\"",
                "tutorial": "📝 PROJECT ZOMBOID - HORDAS\n\n🔌 CONFIGURACIÓN RCON:\nEn ServerSettings.ini:\n  RCONPort=27015\n  RCONPassword=\"tu-password\"\n\n🧟 CREATEHORDE:\nSpawn de N zombies cerca de un jugador.\nSintaxis: createhorde N username\n\nEjemplos:\n• 5 zombies:Horda Pequeña:5\n• 20 zombies:Horda Mediana:20\n• 50 zombies:HORDA CAOS:50\n• 100 zombies:APOCALIPSIS:100\n\n💡 USO desde MARU:\nLas reglas pueden disparar createhorde con cantidad variable según el gift.\n\n⚠️ Si el username está vacío, se spawnea cerca de quien ejecutó el comando."
            },
            {
                "id": "items",
                "name": "📦 Items",
                "type": "item",
                "icon": "📦",
                "data_key": "items",
                "endpoint": "",
                "payload": "",
                "rcon_cmd": "additem \"{user}\" \"{entity}\" {amount}",
                "tutorial": "📝 PROJECT ZOMBOID - ITEMS\n\n🎒 ADDITEM SINTAXIS:\n  additem \"username\" \"module.item\" count\n\n🔫 ARMAS DE FUEGO:\n• Hacha Bomberos:Base.AxeBlackFireman\n• Pistola:Base.Pistol\n• Escopeta:Base.DoubleBarrelShotgun\n• Rifle:Base.HuntingRifle\n• Subfusil:Base.AssaultRifle\n\n🔪 MELEE:\n• Hacha:Base.Axe\n• Cuchillo Cocina:Base.KitchenKnife\n• Bate Béisbol:Base.BaseballBat\n• Katana:Base.Katana (mod)\n\n💊 MÉDICO:\n• Botiquín:Base.FirstAidKit\n• Vendaje:Base.Bandage\n• Pastillas Dolor:Base.Pills\n• Antibiotico:Base.Antibiotics\n\n🍔 COMIDA:\n• Lata Atún:Base.TinnedTuna\n• Pan:Base.Bread\n• Agua Botella:Base.WaterBottleFull\n\n⚠️ Build 42 cambió IDs: revisá pzwiki.net antes."
            },
            {
                "id": "events",
                "name": "⚡ Eventos / Caos",
                "type": "event",
                "icon": "⚡",
                "data_key": "events",
                "endpoint": "",
                "payload": "",
                "rcon_cmd": "{command}",
                "tutorial": "📝 PROJECT ZOMBOID - EVENTOS\n\n🌩️ CLIMA / EVENTOS GLOBALES:\n• Trueno:thunder\n• Rayo:lightning\n• Helicóptero:chopper (atrae horda)\n• Disparo Lejos:gunshot (atrae zombies)\n\n💀 VIDA / SALUD:\n• Matar player:kill \"username\"\n• Teleport spawn:teleport \"user\" 10000 10000 0\n\n🌍 SERVIDOR:\n• Reload Lua:reloadlua\n• Save:save\n• Aviso:servermsg \"texto\"\n• Salud servidor:players\n\n🚁 AIRDROP / SUMINISTROS:\n• Airdrop:airdrop (con mod)\n\n⚠️ Algunos comandos requieren admin permissions previas."
            }
        ],
        "spawn_endpoint": "",
        "item_endpoint": "",
        "event_endpoint": "",
        "spawn_payload": "",
        "item_payload": "",
        "event_payload": "",
        "rcon_spawn_cmd": "createhorde {amount} \"{user}\"",
        "rcon_item_cmd": "additem \"{user}\" \"{entity}\" {amount}",
        "rcon_event_cmd": "{command}",
    }


def icarus_profile() -> dict:
    return {
        "id": "icarus",
        "name": "ICARUS",
        "icon": "🛸",
        "host": "127.0.0.1",
        "port": 25575,
        "connection_type": "rcon",
        "has_entities": False,
        "has_items": False,
        "has_events": True,
        "cover_image": "icarus.jpg",
        "requires_mod": False,
        "categories": [
            {
                "id": "events",
                "name": "📢 Comandos de Servidor",
                "type": "event",
                "icon": "📢",
                "data_key": "events",
                "endpoint": "",
                "payload": "",
                "rcon_cmd": "{command}",
                "tutorial": "📝 ICARUS - COMANDOS\n\n🔌 CONFIGURACIÓN RCON:\nEn ServerSettings.ini:\n  RCONEnabled=true\n  RCONPort=25575\n  RCONPassword=\"tu-password\"\n\n📢 COMANDOS DISPONIBLES:\n• Anuncio:AdminSay El chat te observa\n• Mensaje:AdminSay {value}\n• Kick player:KickPlayer SteamID\n• Ban player:BanPlayer SteamID\n• Lobby:ReturnToLobby\n\n⚠️ ICARUS PvE: el énfasis está en moderación + anuncios.\nNo tiene comandos nativos de spawn/give de fauna o items.\n\n💡 IDEAS de uso:\n• Gift grande → AdminSay '@user envió X gifts'\n• Comando !raid → ReturnToLobby (drama)\n• Sub → KickPlayer del troll designado"
            }
        ],
        "spawn_endpoint": "",
        "item_endpoint": "",
        "event_endpoint": "",
        "spawn_payload": "",
        "item_payload": "",
        "event_payload": "",
        "rcon_spawn_cmd": "",
        "rcon_item_cmd": "",
        "rcon_event_cmd": "{command}",
    }


def green_hell_profile() -> dict:
    return {
        "id": "green_hell",
        "name": "Green Hell",
        "icon": "🌴",
        "host": "127.0.0.1",
        "port": 5000,
        "connection_type": "http",
        "has_entities": True,
        "has_items": True,
        "has_events": True,
        "cover_image": "green_hell.jpg",
        "requires_mod": True,
        "categories": [
            {
                "id": "entities",
                "name": "🐍 Animales / Amenazas",
                "type": "entity",
                "icon": "🐍",
                "data_key": "entities",
                "endpoint": "/spawn",
                "payload": "{\"entity_name\": \"{entity}\", \"amount\": {amount}}",
                "rcon_cmd": "",
                "tutorial": "📝 GREEN HELL - ANIMALES\n\n⚠️ REQUIERE MOD BepInEx (en desarrollo).\nEste perfil reserva el lugar en MARU para cuando el mod esté listo.\n\n🌴 BASE: el mod 'Spawn' de dusrdev/Spawn (GitHub) ya tiene funciones de spawn implementadas. El mod MARU se basaría en él agregando un HTTP listener.\n\n🐍 ANIMALES PLANEADOS:\n• Jaguar (caza al player)\n• Anaconda\n• Caimán\n• Capybara (loot)\n• Tapir (loot)\n• Mono araña (drops fruta)\n• Tucán (cosmético)\n• Hormigas asesinas (parásitos)\n• Sanguijuelas (sangrado)\n\n💡 Cuando el mod esté listo, MARU detectará el endpoint HTTP\nautomáticamente vía healthcheck."
            },
            {
                "id": "items",
                "name": "📦 Recursos / Items",
                "type": "item",
                "icon": "📦",
                "data_key": "items",
                "endpoint": "/give",
                "payload": "{\"entity_name\": \"{entity}\", \"amount\": {amount}}",
                "rcon_cmd": "",
                "tutorial": "📝 GREEN HELL - ITEMS\n\n⚠️ REQUIERE MOD BepInEx (en desarrollo).\n\n📦 ITEMS PLANEADOS:\n• Machete\n• Arco + Flechas\n• Hoja Plantas (curativa)\n• Vendaje\n• Lanza\n• Antiveneno\n• Maracas Antimosquitos\n• Trampa Caza\n• Hojas Banana (techo)\n• Bambú\n\n💊 ESPECIALES:\n• Larva (comida emergencia)\n• Ayahuasca (visión)\n• Hojas Coca (resistencia)"
            },
            {
                "id": "events",
                "name": "⚡ Eventos / Caos",
                "type": "event",
                "icon": "⚡",
                "data_key": "events",
                "endpoint": "/event",
                "payload": "{\"command\": \"{command}\", \"value\": \"{value}\"}",
                "rcon_cmd": "",
                "tutorial": "📝 GREEN HELL - EVENTOS\n\n⚠️ REQUIERE MOD BepInEx (en desarrollo).\n\n💀 SALUD / PARÁSITOS:\n• Bajar Hidratación:dehydrate\n• Subir Fiebre:fever\n• Inyectar parásitos:parasites\n• Sangrado:bleed\n• Veneno:poison\n• Heridas tropicales:wounds\n\n🌧️ CLIMA:\n• Tormenta tropical:storm\n• Llovizna:rain\n• Sol abrasador:hot\n\n🦟 EVENTOS DRAMA:\n• Mosquitos malaria:malaria\n• Pesadilla:nightmare\n• Reloj reset:resetday"
            }
        ],
        "spawn_endpoint": "/spawn",
        "item_endpoint": "/give",
        "event_endpoint": "/event",
        "spawn_payload": "{\"entity_name\": \"{entity}\", \"amount\": {amount}}",
        "item_payload": "{\"entity_name\": \"{entity}\", \"amount\": {amount}}",
        "event_payload": "{\"command\": \"{command}\", \"value\": \"{value}\"}",
        "rcon_spawn_cmd": "",
        "rcon_item_cmd": "",
        "rcon_event_cmd": "",
    }


def core_keeper_profile() -> dict:
    return {
        "id": "core_keeper",
        "name": "Core Keeper",
        "icon": "⛏️",
        "host": "127.0.0.1",
        "port": 5000,
        "connection_type": "http",
        "has_entities": True,
        "has_items": True,
        "has_events": True,
        "cover_image": "core_keeper.jpg",
        "requires_mod": True,
        "categories": [
            {
                "id": "entities",
                "name": "👹 Mobs / Bosses",
                "type": "entity",
                "icon": "👹",
                "data_key": "entities",
                "endpoint": "/spawn",
                "payload": "{\"entity_name\": \"{entity}\", \"amount\": {amount}}",
                "rcon_cmd": "",
                "tutorial": "📝 CORE KEEPER - MOBS / BOSSES\n\n⚠️ REQUIERE MOD BepInEx (en desarrollo).\nCore Keeper usa Unity IL2CPP — más quisquilloso que Mono.\nEl mod necesitará CoreLib + Harmony patches.\n\n👹 MOBS COMUNES:\n• Slime\n• Larva\n• Cavelings (3 tipos)\n• Salamander\n• Skeleton\n• Mold (bio)\n• Rune Knight\n\n⭐ JEFES:\n• Glurch the Abominous Mass\n• Ghorm the Devourer\n• The Hive Mother\n• Azeos the Sky Titan\n• Omoroth the Sea Titan\n• Ra-Akar the Sand Titan\n• Morpha the Aquatic Mass\n\n💡 Cuando el mod esté listo, MARU lo detectará por healthcheck."
            },
            {
                "id": "items",
                "name": "📦 Items / Recursos",
                "type": "item",
                "icon": "📦",
                "data_key": "items",
                "endpoint": "/give",
                "payload": "{\"entity_name\": \"{entity}\", \"amount\": {amount}}",
                "rcon_cmd": "",
                "tutorial": "📝 CORE KEEPER - ITEMS\n\n⚠️ REQUIERE MOD BepInEx (en desarrollo).\n\n📦 ITEMS PLANEADOS:\n• Wooden Pickaxe\n• Tin Pickaxe\n• Iron Pickaxe\n• Scarlet Sword\n• Shrine Doctor's Bow\n• Cooked Slime Burger (food)\n• Health Potion\n• Mana Potion\n\n💎 RECURSOS:\n• Copper Bar / Tin Bar / Iron Bar\n• Gem of Life\n• Scarlet Ore\n• Octarine Ore\n• Galaxite Ore"
            },
            {
                "id": "events",
                "name": "⚡ Eventos / Caos",
                "type": "event",
                "icon": "⚡",
                "data_key": "events",
                "endpoint": "/event",
                "payload": "{\"command\": \"{command}\", \"value\": \"{value}\"}",
                "rcon_cmd": "",
                "tutorial": "📝 CORE KEEPER - EVENTOS\n\n⚠️ REQUIERE MOD BepInEx (en desarrollo).\n\n💀 PLAYER:\n• Heal:heal\n• Damage:damage\n• Death:kill\n• Teleport spawn:tp_spawn\n• God mode:god\n\n🌍 MUNDO:\n• Spawn boss aleatorio:random_boss\n• Día / Noche:toggle_time\n• Reveal map:reveal\n• Reset map:reset_map\n\n🎁 REWARDS:\n• XP:xp\n• Skill points:skill_pts\n• Buff temporal:buff"
            }
        ],
        "spawn_endpoint": "/spawn",
        "item_endpoint": "/give",
        "event_endpoint": "/event",
        "spawn_payload": "{\"entity_name\": \"{entity}\", \"amount\": {amount}}",
        "item_payload": "{\"entity_name\": \"{entity}\", \"amount\": {amount}}",
        "event_payload": "{\"command\": \"{command}\", \"value\": \"{value}\"}",
        "rcon_spawn_cmd": "",
        "rcon_item_cmd": "",
        "rcon_event_cmd": "",
    }


# Cover images de los standards (para que la galería los pinte iguales)
STANDARD_COVERS = {
    "valheim": "valheim.jpg",
    "terraria": "terraria.jpg",
    # minecraft: no en Steam → fallback gradient + emoji en frontend
}


def main() -> None:
    raw = json.loads(GAMES_JSON.read_text(encoding="utf-8"))

    custom_games = raw.setdefault("custom_games", {})
    new_profiles = [
        palworld_profile(),
        ark_ascended_profile(),
        project_zomboid_profile(),
        icarus_profile(),
        green_hell_profile(),
        core_keeper_profile(),
    ]

    added = []
    for prof in new_profiles:
        gid = prof["id"]
        if gid in custom_games:
            print(f"  ↪ {gid}: ya existe, no se pisa")
            continue
        custom_games[gid] = prof
        added.append(gid)

    # También agregar coverImage a customs existentes (repo, ror2, 7days)
    for gid, cover in [
        ("repo", "repo.jpg"),
        ("ror2", "ror2.jpg"),
        ("7_days_to_die", "7daystodie.jpg"),
    ]:
        if gid in custom_games and "cover_image" not in custom_games[gid]:
            custom_games[gid]["cover_image"] = cover

    # Cover de game_configs (overrides standards)
    game_configs = raw.setdefault("game_configs", {})
    for gid, cover in STANDARD_COVERS.items():
        if gid in game_configs:
            game_configs[gid].setdefault("cover_image", cover)

    GAMES_JSON.write_text(json.dumps(raw, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n✅ Agregados {len(added)} perfiles: {added}")
    print(f"   Total custom_games: {len(custom_games)}")
    print(f"   File: {GAMES_JSON}")


if __name__ == "__main__":
    main()
