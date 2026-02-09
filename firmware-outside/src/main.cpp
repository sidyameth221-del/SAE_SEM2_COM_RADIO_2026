#include <Arduino.h>
#include <SPI.h>
#include <RF24.h>
#include <DHT.h>

#include "config.h"

static constexpr uint32_t SENSOR_PERIOD_MS = 3000;

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

static uint32_t sensorSeq = 0;
static uint32_t commandSeq = 0;
static bool lampOn = false;

static void applyLamp(bool on) {
  lampOn = on;
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(PIN_RELAY, lampOn ? LOW : HIGH);
  } else {
    digitalWrite(PIN_RELAY, lampOn ? HIGH : LOW);
  }
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

  radio.openWritingPipe(PIPE_OUT_TO_IN);
  radio.openReadingPipe(1, PIPE_IN_TO_OUT);
  radio.startListening();

  Serial.println("[RF] OK");
}

static void pollIncomingCommand() {
  while (radio.available()) {
    CommandPayload cmd{};
    radio.read(&cmd, sizeof(cmd));
    commandSeq = cmd.seq;
    applyLamp(cmd.lamp == 1);
    Serial.printf("[CMD] lamp=%s seq=%lu\n", lampOn ? "ON" : "OFF", (unsigned long)commandSeq);
  }
}

static void sendSensor() {
  const float h = dht.readHumidity();
  const float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) {
    Serial.println("[DHT] read failed");
    return;
  }

  SensorPayload payload{};
  payload.temperature = t;
  payload.humidity = h;
  payload.seq = ++sensorSeq;

  radio.stopListening();
  const bool ok = radio.write(&payload, sizeof(payload));
  radio.startListening();
  Serial.printf("[TX] t=%.1f h=%.1f seq=%lu ok=%d\n", t, h, (unsigned long)payload.seq, ok ? 1 : 0);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(PIN_RELAY, OUTPUT);
  applyLamp(false);

  dht.begin();
  SPI.begin(18, 19, 23);
  setupRadio();

  Serial.println("[BOOT] outside ready");
}

void loop() {
  static uint32_t lastSensorMs = 0;

  pollIncomingCommand();

  if (millis() - lastSensorMs >= SENSOR_PERIOD_MS) {
    lastSensorMs = millis();
    sendSensor();
  }
}
