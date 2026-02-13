#include <Arduino.h>
#include <WiFi.h>
#include <time.h>

#include <SPI.h>
#include <RF24.h>

#include <DHT.h>

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// FirebaseClient (Mobizt)
#define ENABLE_USER_AUTH
#define ENABLE_DATABASE
#include <WiFiClientSecure.h>
#include <FirebaseClient.h>

#include "config.h"

// The user must create secrets.h from secrets.example.h
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Missing secrets.h. Copy include/secrets.example.h to include/secrets.h and fill your values."
#endif

static constexpr uint32_t SENSOR_PERIOD_MS = 3000;
static constexpr uint32_t FIREBASE_PERIOD_MS = 500;
static constexpr uint32_t SETTINGS_PERIOD_MS = 10000;
static constexpr uint32_t DEFAULT_LOG_PERIOD_MS = 3000;

struct SensorPayload {
  float temperature;
  float humidity;
  uint32_t seq;
};

struct CommandPayload {
  uint8_t lamp; // 1=ON, 0=OFF
  uint32_t seq;
};

RF24 radio(PIN_RF_CE, PIN_RF_CSN);
DHT dht(PIN_DHT, DHT22);
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);

UserAuth user_auth(FIREBASE_API_KEY, FIREBASE_USER_EMAIL, FIREBASE_USER_PASSWORD);
FirebaseApp app;
WiFiClientSecure ssl_client;
using AsyncClient = AsyncClientClass;
AsyncClient aClient(ssl_client);
RealtimeDatabase Database;

static uint32_t cmdSeq = 0;
static bool lampOn = false;

static uint32_t logPeriodMs = DEFAULT_LOG_PERIOD_MS;
static uint32_t lastLogMs = 0;

static bool outsideValid = false;
static SensorPayload outsideLast{};

static void firebaseReadSettings() {
  if (!app.ready()) return;

  const String path = String("/homes/") + HOME_ID + "/settings/logPeriodSec";
  const String s = Database.get<String>(aClient, path.c_str());
  if (aClient.lastError().code() != 0) return;

  const long sec = s.toInt();
  if (sec < 1 || sec > 3600) return;

  const uint32_t nextMs = (uint32_t)sec * 1000U;
  if (nextMs != logPeriodMs) {
    logPeriodMs = nextMs;
    Serial.printf("[SET] logPeriodSec=%ld\n", sec);
  }
}

static String isoNowUtc() {
  time_t now = time(nullptr);
  struct tm tmUtc;
  gmtime_r(&now, &tmUtc);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmUtc);
  return String(buf);
}

static String frNowLocalShort() {
  time_t now = time(nullptr);
  struct tm tmLocal;
  localtime_r(&now, &tmLocal);
  char buf[24];
  strftime(buf, sizeof(buf), "%d/%m %H:%M:%S", &tmLocal);
  return String(buf);
}

static void wifiConnect() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] connecting to %s\n", WIFI_SSID);

  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] OK ip=%s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[WiFi] FAILED");
  }
}

static void ntpSync() {
  // France timezone with DST (CET/CEST)
  // CET-1  => UTC+1 in winter, CEST => UTC+2 in summer
  configTzTime("CET-1CEST,M3.5.0/2,M10.5.0/3", "pool.ntp.org", "time.nist.gov");
  Serial.println("[NTP] syncing...");
  const uint32_t start = millis();
  while (time(nullptr) < 1700000000 && millis() - start < 20000) {
    delay(250);
    Serial.print('#');
  }
  Serial.println();
  Serial.printf("[NTP] local=%s utc=%s\n", frNowLocalShort().c_str(), isoNowUtc().c_str());
}

static void firebaseInit() {
  ssl_client.setInsecure();
  ssl_client.setHandshakeTimeout(5);

  initializeApp(aClient, app, getAuth(user_auth), 5000);
  app.getApp<RealtimeDatabase>(Database);
  Database.url(FIREBASE_DATABASE_URL);
  Serial.println("[FB] init");
}

static void setupRadio() {
  if (!radio.begin()) {
    Serial.println("[RF] begin() FAILED");
    return;
  }
  // Make RF behavior explicit and more robust.
  // Channel 108 is typically above crowded 2.4GHz Wi‑Fi channels.
  radio.setChannel(108);
  radio.setCRCLength(RF24_CRC_16);
  radio.setPALevel(RF24_PA_HIGH);
  radio.setDataRate(RF24_250KBPS);
  radio.setRetries(5, 15);
  radio.setPayloadSize(sizeof(SensorPayload));

  radio.openWritingPipe(PIPE_IN_TO_OUT);
  radio.openReadingPipe(1, PIPE_OUT_TO_IN);
  radio.startListening();
  Serial.println("[RF] OK");
}

static void oledInit() {
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("[OLED] begin failed");
    return;
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.display();
  Serial.println("[OLED] OK");
}

static void oledRender(float inT, float inH, const String &ts) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  // Header
  display.setCursor(0, 0);
  display.print("SAE RADIO");
  display.setCursor(86, 0);
  display.print(lampOn ? "L:ON" : "L:OFF");
  display.drawLine(0, 10, OLED_WIDTH - 1, 10, SSD1306_WHITE);

  // Inside row
  display.setCursor(0, 14);
  display.print("IN ");
  if (isnan(inT)) {
    display.print("--.-C");
  } else {
    display.printf("%4.1fC", inT);
  }
  display.setCursor(80, 14);
  if (isnan(inH)) {
    display.print("---%");
  } else {
    display.printf("%3.0f%%", inH);
  }

  // Outside row
  display.setCursor(0, 28);
  display.print("OUT");
  display.setCursor(24, 28);
  if (!outsideValid || isnan(outsideLast.temperature)) {
    display.print("--.-C");
  } else {
    display.printf("%4.1fC", outsideLast.temperature);
  }
  display.setCursor(80, 28);
  if (!outsideValid || isnan(outsideLast.humidity)) {
    display.print("---%");
  } else {
    display.printf("%3.0f%%", outsideLast.humidity);
  }

  display.drawLine(0, 44, OLED_WIDTH - 1, 44, SSD1306_WHITE);

  // Footer timestamp (trim if too long)
  String tline = ts;
  if (tline.length() > 21) tline = tline.substring(tline.length() - 21);
  display.setCursor(0, 54);
  display.print(tline);
  display.display();
}

static void pollOutsideRadio() {
  while (radio.available()) {
    SensorPayload payload{};
    radio.read(&payload, sizeof(payload));
    outsideLast = payload;
    outsideValid = true;
    Serial.printf("[RX] out t=%.1f h=%.1f seq=%lu\n", payload.temperature, payload.humidity, (unsigned long)payload.seq);
  }
}

static bool sendLampCommand(bool on) {
  CommandPayload cmd{};
  cmd.lamp = on ? 1 : 0;
  cmd.seq = ++cmdSeq;

  bool ok = false;
  // Retry a few times to avoid missing the receiver window.
  for (int attempt = 1; attempt <= 6 && !ok; attempt++) {
    radio.stopListening();
    ok = radio.write(&cmd, sizeof(cmd));
    radio.startListening();
    if (!ok) delay(40);
  }

  Serial.printf("[TX] lamp=%s seq=%lu ok=%d\n", on ? "ON" : "OFF", (unsigned long)cmd.seq, ok ? 1 : 0);
  return ok;
}

static bool firebaseReadLamp() {
  if (!app.ready()) return false;

  const String path = String("/homes/") + HOME_ID + "/commands/lamp/state";
  const String s = Database.get<String>(aClient, path.c_str());
  if (aClient.lastError().code() != 0) {
    static uint32_t lastErrLogMs = 0;
    const uint32_t nowMs = millis();
    if (nowMs - lastErrLogMs > 5000) {
      lastErrLogMs = nowMs;
      Serial.printf("[FB] lamp read error code=%d\n", aClient.lastError().code());
    }
    return false;
  }

  static String lastSeen = "";
  if (s != lastSeen) {
    lastSeen = s;
    Serial.printf("[FB] lamp state=%s\n", s.c_str());
  }

  const bool desired = (s == "ON");
  if (desired != lampOn) {
    lampOn = desired;
    const bool ok = sendLampCommand(lampOn);
    if (!ok) {
      Serial.println("[RF] lamp send FAILED (no ACK)");
    }
  }
  return true;
}

static void firebaseWriteMeasurements(const String &ts, float inT, float inH) {
  if (!app.ready()) return;

  const String base = String("/homes/") + HOME_ID + "/measurements/" + ts;
  Database.set<float>(aClient, (base + "/inside/temperature").c_str(), inT);
  Database.set<float>(aClient, (base + "/inside/humidity").c_str(), inH);
  if (outsideValid) {
    Database.set<float>(aClient, (base + "/outside/temperature").c_str(), outsideLast.temperature);
    Database.set<float>(aClient, (base + "/outside/humidity").c_str(), outsideLast.humidity);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  dht.begin();
  Wire.begin();
  oledInit();

  SPI.begin(18, 19, 23);
  setupRadio();

  wifiConnect();
  ntpSync();
  firebaseInit();

  Serial.println("[BOOT] inside ready");
}

void loop() {
  app.loop();
  pollOutsideRadio();

  static uint32_t lastSensorMs = 0;
  static uint32_t lastFirebaseMs = 0;
  static uint32_t lastSettingsMs = 0;

  const uint32_t nowMs = millis();

  if (nowMs - lastSettingsMs >= SETTINGS_PERIOD_MS) {
    lastSettingsMs = nowMs;
    firebaseReadSettings();
  }

  if (nowMs - lastSensorMs >= SENSOR_PERIOD_MS) {
    lastSensorMs = nowMs;
    const float inH = dht.readHumidity();
    const float inT = dht.readTemperature();
    if (!isnan(inH) && !isnan(inT)) {
      oledRender(inT, inH, frNowLocalShort());
      if (nowMs - lastLogMs >= logPeriodMs) {
        lastLogMs = nowMs;
        const String ts = isoNowUtc();
        firebaseWriteMeasurements(ts, inT, inH);
        Serial.printf("[IN] t=%.1f h=%.1f ts=%s\n", inT, inH, ts.c_str());
      } else {
        Serial.printf("[IN] t=%.1f h=%.1f (no log)\n", inT, inH);
      }
    } else {
      Serial.println("[DHT] inside read failed");
    }
  }

  if (nowMs - lastFirebaseMs >= FIREBASE_PERIOD_MS) {
    lastFirebaseMs = nowMs;
    firebaseReadLamp();
  }
}
