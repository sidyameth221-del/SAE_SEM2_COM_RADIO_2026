# SAE SEM2 – COM RADIO (ESP32 + nRF24 + Firebase)

Monorepo simple :

- `firmware-outside/` : ESP32 extérieur (DHT22 + nRF24 + relais)
- `firmware-inside/` : ESP32 intérieur (DHT22 + nRF24 + Wi‑Fi + NTP + Firebase RTDB + OLED)
- `web/` : dashboard (Next.js + Firebase Auth + Realtime Database)
- `firebase/` : règles RTDB

## 1) Prérequis (Windows)

### PlatformIO (CLI)
Si `pio` n’est pas reconnu, installe PlatformIO via Python :

```powershell
py -m pip install --upgrade pip
py -m pip install platformio
```

### Node
Ton PowerShell bloque `npm.ps1` (ExecutionPolicy). Utilise `npm.cmd` / `npx.cmd`.

## 2) Firmware (PlatformIO)

Build / upload (au choix) :

```powershell
py -m platformio run -d firmware-outside
py -m platformio run -d firmware-inside
```

Upload (flash) sur l’ESP32 :

```powershell
py -m platformio run -d firmware-outside -t upload
py -m platformio run -d firmware-inside -t upload
```

Monitor série :

```powershell
py -m platformio device monitor -d firmware-inside
```

Lister les ports (pour savoir quel COM utiliser) :

```powershell
py -m platformio device list
```

Si besoin de forcer le port (ex: COM5), ajoute dans `platformio.ini` du projet concerné :

```ini
upload_port = COM5
monitor_port = COM5
```

### Secrets (ESP32 inside)
Copie :

- `firmware-inside/include/secrets.example.h` -> `firmware-inside/include/secrets.h`

Puis remplis Wi‑Fi + Firebase.

Maison (HOME_ID) :

- Tu changes `HOME_ID` dans [firmware-inside/include/secrets.h](firmware-inside/include/secrets.h)
- Exemple : `#define HOME_ID "homeA"`

## 3) Firebase Realtime Database

Règles RTDB : `firebase/database.rules.json`.

Chemins utilisés :

- `users/<uid>/homeId`
- `homes/<HOME_ID>/measurements/<ISO_TIMESTAMP>/inside/*`
- `homes/<HOME_ID>/measurements/<ISO_TIMESTAMP>/outside/*`
- `homes/<HOME_ID>/commands/lamp/state`
- `homes/<HOME_ID>/commands/lamp/timestamp`

## 4) Web (Next.js)

Une fois le dossier `web/` généré (je le fais juste après), lancer :

```powershell
cd web
npm.cmd install
npm.cmd run dev
```

### Accès au site web : local ou pas ?

- **En mode dev (`npm.cmd run dev`)**: oui c’est principalement **local** sur ton PC.
- Sur le **même Wi‑Fi**, tu peux aussi l’ouvrir depuis un téléphone/PC : il suffit d’exposer le serveur sur le réseau (je peux te le configurer si tu veux).
- Si tu veux l’ouvrir **de n’importe où**, il faut le **déployer** (ex: Vercel). Ce n’est pas limité au local.

## Pins (câblage recommandé)

Les GPIO utilisés sont définis dans :

- `firmware-inside/include/config.h`
- `firmware-outside/include/config.h`

### ESP32 intérieur (Wi‑Fi + OLED + nRF24)

| Module | Signal | Pin sur la carte | GPIO | Notes |
|---|---:|---:|---:|---|
| DHT22 (intérieur) | DATA | D4 | 4 | VCC=3V3, GND commun |
| OLED I2C (SSD1306) | SDA | D21 | 21 | I2C par défaut ESP32 |
| OLED I2C (SSD1306) | SCL | D22 | 22 | I2C par défaut ESP32 |
| nRF24L01 | CE | TX2 | 17 | 3V3 uniquement |
| nRF24L01 | CSN | RX2 | 16 | 3V3 uniquement |
| nRF24L01 (VSPI) | SCK | D18 | 18 | SPI VSPI ESP32 |
| nRF24L01 (VSPI) | MISO | D19 | 19 | SPI VSPI ESP32 |
| nRF24L01 (VSPI) | MOSI | D23 | 23 | SPI VSPI ESP32 |
| nRF24L01 | IRQ | — | — | Non connecté |

### ESP32 extérieur (DHT22 + relais + nRF24)

| Module | Signal | Pin sur la carte | GPIO | Notes |
|---|---:|---:|---:|---|
| DHT22 (extérieur) | DATA | D4 | 4 | VCC=3V3, GND commun |
| Relais (lampe) | IN | D26 | 26 | Logique active HIGH par défaut (voir note) |
| nRF24L01 | CE | TX2 | 17 | 3V3 uniquement |
| nRF24L01 | CSN | RX2 | 16 | 3V3 uniquement |
| nRF24L01 (VSPI) | SCK | D18 | 18 | SPI VSPI ESP32 |
| nRF24L01 (VSPI) | MISO | D19 | 19 | SPI VSPI ESP32 |
| nRF24L01 (VSPI) | MOSI | D23 | 23 | SPI VSPI ESP32 |
| nRF24L01 | IRQ | — | — | Non connecté |

### Notes importantes

- Mets **un condensateur 10µF–47µF** entre VCC/GND du nRF24L01 (proche du module) si tu as des pertes radio.
- Certains relais sont **actifs à LOW** : si ta lampe est inversée, il faudra inverser la logique dans `firmware-outside/src/main.cpp` (fonction `applyLamp`).
