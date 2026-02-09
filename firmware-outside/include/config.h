#pragma once

#include <stdint.h>

// ===== Pins (ESP32 outside) =====
// DHT22
#define PIN_DHT 4

// Relay (active HIGH by default in code; change if needed)
#define PIN_RELAY 26

// Set to 1 if your relay module is active-LOW (very common).
#define RELAY_ACTIVE_LOW 1

// nRF24L01 (SPI VSPI: SCK=18, MISO=19, MOSI=23)
#define PIN_RF_CE 17
#define PIN_RF_CSN 16

// ===== Radio addresses =====
// Outside -> Inside
static const uint64_t PIPE_OUT_TO_IN = 0xE8E8F0F0E1LL;
// Inside -> Outside
static const uint64_t PIPE_IN_TO_OUT = 0xE8E8F0F0E2LL;
