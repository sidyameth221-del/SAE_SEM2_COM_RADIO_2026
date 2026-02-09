 #pragma once

#include <stdint.h>

// ===== Pins (ESP32 inside) =====
// DHT22
#define PIN_DHT 4

// OLED I2C (default ESP32 pins)
// SDA=21, SCL=22

// nRF24L01 (SPI VSPI: SCK=18, MISO=19, MOSI=23)
#define PIN_RF_CE 17
#define PIN_RF_CSN 16

// ===== Radio addresses =====
static const uint64_t PIPE_OUT_TO_IN = 0xE8E8F0F0E1LL;
static const uint64_t PIPE_IN_TO_OUT = 0xE8E8F0F0E2LL;

// ===== OLED =====
#define OLED_WIDTH 128
#define OLED_HEIGHT 64
#define OLED_ADDR 0x3C
