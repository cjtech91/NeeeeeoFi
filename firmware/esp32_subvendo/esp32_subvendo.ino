#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <HTTPClient.h>

// --- Configuration Structure ---
struct Config {
  char ssid[32];
  char password[32];
  // char serverIp[16]; // Removed: Auto-detected
  char subVendoKey[32];
  char deviceName[32];
  char relayActiveState[8]; // "HIGH" or "LOW"
  int coinPin;
  int relayPin;
  int pesoPerPulse;
  int billPin;
  int billMultiplier;
  int standbyLedPin;
  int insertLedPin;
  bool configured;
};

Config config;
WebServer server(80);
DNSServer dnsServer;
volatile uint16_t coinPulseCount = 0;
volatile uint16_t billPulseCount = 0;
volatile unsigned long lastCoinPulseMs = 0;
volatile unsigned long lastBillPulseMs = 0;
unsigned long lastCoinSendMs = 0;

// Default Pin Configuration (from PCB)
const int DEFAULT_COIN_PIN = 13;
const int DEFAULT_RELAY_PIN = 12;
const int DEFAULT_BILL_PIN = 16;
const int DEFAULT_STANDBY_LED_PIN = 18;
const int DEFAULT_INSERT_LED_PIN = 5;
const int DEFAULT_BILL_MULTIPLIER = 10;

uint8_t currentCoinPin = DEFAULT_COIN_PIN;
uint8_t currentRelayPin = DEFAULT_RELAY_PIN;
uint8_t currentBillPin = DEFAULT_BILL_PIN;
uint8_t currentStandbyLedPin = DEFAULT_STANDBY_LED_PIN;
uint8_t currentInsertLedPin = DEFAULT_INSERT_LED_PIN;

// --- Constants ---
const int EEPROM_SIZE = 1024; // Increased for safety
const int CONFIG_ADDR = 0;
const int BUILTIN_LED_PIN = 2; // Onboard LED for status
const int RESET_BUTTON_PIN = 0; // BOOT Button (GPIO 0)

// --- Function Prototypes ---
void loadConfig();
void saveConfig();
void startAPMode();
void startClientMode();
void handleRoot();
void handleScan();
void handleSave();
void handleRelay();
void bindDevice();
String getMacAddress();
void handleCaptive();
void handleNotFound();
uint8_t resolvePin(int configuredPin, uint8_t defaultPin, bool isOutput);
void applyHardwareConfig();
void IRAM_ATTR onCoinPulse();
void IRAM_ATTR onBillPulse();
void sendCoinPulses(uint16_t pulses);
int extractJsonInt(const String& payload, const String& key, int defaultVal);
String extractJsonString(const String& payload, const String& key, String defaultVal);

void setup() {
  Serial.begin(115200);
  EEPROM.begin(EEPROM_SIZE);
  pinMode(BUILTIN_LED_PIN, OUTPUT);
  pinMode(RESET_BUTTON_PIN, INPUT_PULLUP);
  
  digitalWrite(BUILTIN_LED_PIN, LOW); // OFF

  delay(2000);
  Serial.println("\n\n--- NeoFi Sub Vendo Node (ESP32) ---");

  // Check if Reset Button is held on boot (Force Config Mode)
  if (digitalRead(RESET_BUTTON_PIN) == LOW) {
    Serial.println("Reset Button Pressed: Forcing Config Mode...");
    // Blink fast to indicate reset
    for(int i=0; i<10; i++) {
        digitalWrite(BUILTIN_LED_PIN, HIGH); delay(50);
        digitalWrite(BUILTIN_LED_PIN, LOW); delay(50);
    }
    startAPMode();
    return;
  }

  loadConfig();

  if (!config.configured) {
    Serial.println("No configuration found. Starting AP Mode...");
    startAPMode();
  } else {
    Serial.println("Configuration found. Starting Client Mode...");
    startClientMode();
  }
}

void checkFactoryReset() {
  // Check BOOT Button (GPIO 0) for long press during runtime
  
  static int resetCounter = 0;
  static unsigned long lastCheck = 0;
  
  if (millis() - lastCheck > 100) {
    lastCheck = millis();
    
    // GPIO 0 is usually pulled up. Pressing it pulls it LOW.
    int val = digitalRead(RESET_BUTTON_PIN);
    
    if (val == LOW) {
      resetCounter++;
    } else {
      resetCounter = 0;
    }

    // Trigger after ~5 seconds (50 * 100ms)
    if (resetCounter > 50) {
      Serial.println("\n\n*** FACTORY RESET TRIGGERED via BOOT Button ***");
      
      // Blink Fast 5 times to confirm
      for(int i=0; i<5; i++) {
        digitalWrite(BUILTIN_LED_PIN, HIGH); delay(100);
        digitalWrite(BUILTIN_LED_PIN, LOW); delay(100);
      }
      
      config.configured = false;
      // Manually write to EEPROM to avoid saveConfig() overriding it to true
      EEPROM.put(CONFIG_ADDR, config);
      EEPROM.commit();
      
      Serial.println("Config cleared. Rebooting...");
      delay(500);
      ESP.restart();
    }
  }
}

void loop() {
  checkFactoryReset();

  if (!config.configured) {
    dnsServer.processNextRequest();
    server.handleClient();
    // Blink slowly in AP mode
    static unsigned long lastBlink = 0;
    if (millis() - lastBlink > 500) {
      lastBlink = millis();
      digitalWrite(BUILTIN_LED_PIN, !digitalRead(BUILTIN_LED_PIN));
    }
  } else {
    // Client Mode Loop
    server.handleClient(); // Handle incoming requests (like /relay)

    if (WiFi.status() == WL_CONNECTED) {
      // --- LED Logic ---
      bool relayOn = (digitalRead(currentRelayPin) == LOW); 
      if (strcmp(config.relayActiveState, "HIGH") == 0) {
         relayOn = (digitalRead(currentRelayPin) == HIGH);
      }
      
      bool pulseActive = (millis() - lastCoinPulseMs < 500) || (millis() - lastBillPulseMs < 500);

      // Built-in LED: Status
      if (relayOn || pulseActive) {
         digitalWrite(BUILTIN_LED_PIN, HIGH); 
      } else {
         digitalWrite(BUILTIN_LED_PIN, LOW); 
      }

      // Standby LED: Always ON when connected (Heartbeat)
      digitalWrite(currentStandbyLedPin, HIGH);

      // Insert LED: Blink on activity, otherwise ON (indicating ready)
      if (pulseActive) {
          // Fast Blink on Coin Insert
          digitalWrite(currentInsertLedPin, (millis() / 100) % 2 == 0 ? HIGH : LOW);
      } else {
          digitalWrite(currentInsertLedPin, HIGH); // Solid ON = Ready
      }

      // --- Coin/Bill Processing ---
      // Check if we have pending pulses to send
      bool hasPulses = (coinPulseCount > 0 || billPulseCount > 0);
      bool coinIdle = (millis() - lastCoinPulseMs) > 300;
      bool billIdle = (millis() - lastBillPulseMs) > 300;
      bool sendCooldown = (millis() - lastCoinSendMs) > 250;

      if (hasPulses && coinIdle && billIdle && sendCooldown) {
        noInterrupts();
        uint16_t cPulses = coinPulseCount;
        uint16_t bPulses = billPulseCount;
        coinPulseCount = 0;
        billPulseCount = 0;
        interrupts();

        lastCoinSendMs = millis();
        
        // Calculate Total Equivalent Pulses
        // Coins = 1 pulse per coin (usually)
        // Bills = 1 pulse per bill * Multiplier (e.g. 10)
        uint16_t totalPulses = cPulses + (bPulses * config.billMultiplier);
        
        if (totalPulses > 0) {
            Serial.printf("Processing: %d Coin Pulses, %d Bill Pulses (x%d) = %d Total\n", 
              cPulses, bPulses, config.billMultiplier, totalPulses);
            sendCoinPulses(totalPulses);
        }
      }
      
      // Send heartbeat periodically to keep status "Online"
      static unsigned long lastHeartbeat = 0;

      if ((millis() - lastHeartbeat) > 60000 && (millis() - lastCoinSendMs) > 1000) { 
         lastHeartbeat = millis();
         bindDevice(); 
      }
    } else {
      // If connection lost, blink fast
      static unsigned long lastBlink = 0;
      if (millis() - lastBlink > 200) {
        lastBlink = millis();
        digitalWrite(BUILTIN_LED_PIN, !digitalRead(BUILTIN_LED_PIN));
        // Turn off external LEDs to indicate offline
        digitalWrite(currentStandbyLedPin, LOW);
        digitalWrite(currentInsertLedPin, LOW);
      }
    }
  }
}

// --- Helper Functions ---

void loadConfig() {
  EEPROM.get(CONFIG_ADDR, config);
  // Basic validation (check if ssid starts with valid char)
  if (config.ssid[0] == 0 || config.ssid[0] == 0xFF) {
    config.configured = false;
  }

  // Set Defaults if invalid
  if (config.coinPin < 0 || config.coinPin > 39) config.coinPin = DEFAULT_COIN_PIN;
  if (config.relayPin < 0 || config.relayPin > 39) config.relayPin = DEFAULT_RELAY_PIN;
  if (config.billPin < 0 || config.billPin > 39) config.billPin = DEFAULT_BILL_PIN;
  if (config.standbyLedPin < 0 || config.standbyLedPin > 39) config.standbyLedPin = DEFAULT_STANDBY_LED_PIN;
  if (config.insertLedPin < 0 || config.insertLedPin > 39) config.insertLedPin = DEFAULT_INSERT_LED_PIN;
  
  if (config.pesoPerPulse < 1 || config.pesoPerPulse > 100) config.pesoPerPulse = 1;
  if (config.billMultiplier < 1 || config.billMultiplier > 1000) config.billMultiplier = DEFAULT_BILL_MULTIPLIER;
  
  if (config.relayActiveState[0] == 0 || config.relayActiveState[0] == 0xFF) strcpy(config.relayActiveState, "LOW");
}

void saveConfig() {
  config.configured = true;
  EEPROM.put(CONFIG_ADDR, config);
  EEPROM.commit();
}

void startAPMode() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP("NeoFi ESP32 Config");
  
  Serial.println("AP Mode Started: NeoFi ESP32 Config");
  Serial.print("IP Address: ");
  Serial.println(WiFi.softAPIP());

  server.on("/", handleRoot);
  server.on("/scan", HTTP_GET, handleScan);
  server.on("/generate_204", HTTP_GET, handleCaptive);
  server.on("/fwlink", HTTP_GET, handleCaptive);
  server.on("/hotspot-detect.html", HTTP_GET, handleCaptive);
  server.on("/ncsi.txt", HTTP_GET, handleCaptive);
  server.on("/save", HTTP_POST, handleSave);
  server.onNotFound(handleNotFound);
  server.begin();
  dnsServer.start(53, "*", WiFi.softAPIP());
  
  config.configured = false; // Mark as not configured runtime flag
}

void startClientMode() {
  WiFi.softAPdisconnect(true);
  dnsServer.stop();
  WiFi.mode(WIFI_STA);
  WiFi.begin(config.ssid, config.password);
  
  Serial.print("Connecting to WiFi: ");
  Serial.println(config.ssid);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    digitalWrite(BUILTIN_LED_PIN, !digitalRead(BUILTIN_LED_PIN)); // Blink while connecting
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());

    applyHardwareConfig();
    
    // Start Web Server for Relay Control
    server.on("/relay", HTTP_GET, handleRelay);
    server.onNotFound([]() { server.send(404, "text/plain", "Not Found"); });
    server.begin();
    Serial.println("Web Server started for Remote Control");
    
    // Attempt to bind immediately
    bindDevice();
  } else {
    Serial.println("\nWiFi Connection Failed. Rebooting in 5s...");
    delay(5000);
    ESP.restart();
  }
}

void handleRelay() {
  if (!server.hasArg("state")) {
    server.send(400, "text/plain", "Missing state (on/off)");
    return;
  }
  
  String state = server.arg("state");
  
  // Sync activeState if provided
  if (server.hasArg("activeState")) {
      String newActiveState = server.arg("activeState");
      if ((newActiveState == "HIGH" || newActiveState == "LOW") && newActiveState != String(config.relayActiveState)) {
          Serial.println("[RELAY] Sync Active State: " + newActiveState);
          newActiveState.toCharArray(config.relayActiveState, 8);
          saveConfig();
      }
  }

  Serial.println("[RELAY] Request: " + state + " (Active: " + String(config.relayActiveState) + ")");
  
  bool activeHigh = (strcmp(config.relayActiveState, "HIGH") == 0);

  if (state == "on") {
    digitalWrite(currentRelayPin, activeHigh ? HIGH : LOW);
    digitalWrite(BUILTIN_LED_PIN, HIGH); // LED ON
    server.send(200, "text/plain", "Relay ON");
  } else if (state == "off") {
    digitalWrite(currentRelayPin, activeHigh ? LOW : HIGH);
    digitalWrite(BUILTIN_LED_PIN, LOW); // LED OFF
    server.send(200, "text/plain", "Relay OFF");
  } else {
    server.send(400, "text/plain", "Invalid state");
  }
}

void handleRoot() {
  // Same HTML as ESP8266 but maybe updated title
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <title>NeoFi ESP32 Config</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f0f2f5; }
    .card { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
    h2 { text-align: center; color: #333; margin-top: 0; }
    input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; }
    select { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; }
    button { width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; font-weight: bold; }
    button:hover { background: #0056b3; }
    label { font-weight: bold; font-size: 0.9em; color: #555; }
  </style>
</head>
<body>
  <div class="card">
    <h2>NeoFi ESP32 Setup</h2>
    <form action="/save" method="POST">
      <label>WiFi SSID</label>
      <select name="ssid" id="ssid" required>
        <option value="" disabled selected>Scanning...</option>
      </select>
      <button type="button" onclick="loadNetworks(true)" style="background:#28a745; margin-bottom: 10px;">Refresh Networks</button>
      <input type="text" name="ssid_manual" id="ssid_manual" placeholder="Enter WiFi Name" style="display:none;">
      <button type="button" id="toggle_manual" style="background:#6c757d; margin-top:0;">Manual SSID</button>
      
      <label>WiFi Password</label>
      <input type="password" name="password" placeholder="Enter WiFi Password">
      
      <label>Sub Vendo Key</label>
      <input type="text" name="key" placeholder="Get this from Admin Panel" required>

      <label>Device Name (Optional)</label>
      <input type="text" name="name" placeholder="e.g. Living Room Node">
      
      <button type="submit">Save & Reboot</button>
    </form>
  </div>
  <script>
    (function() {
      var ssidSelect = document.getElementById('ssid');
      var manualInput = document.getElementById('ssid_manual');
      var toggleBtn = document.getElementById('toggle_manual');
      var useManual = false;

      function setManualMode(on) {
        useManual = on;
        if (useManual) {
          ssidSelect.removeAttribute('required');
          manualInput.setAttribute('required', 'required');
          ssidSelect.style.display = 'none';
          manualInput.style.display = 'block';
          toggleBtn.textContent = 'Use Scan List';
        } else {
          manualInput.removeAttribute('required');
          ssidSelect.setAttribute('required', 'required');
          manualInput.style.display = 'none';
          ssidSelect.style.display = 'block';
          toggleBtn.textContent = 'Manual SSID';
        }
      }

      toggleBtn.addEventListener('click', function(e) {
        e.preventDefault();
        setManualMode(!useManual);
      });

      function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function(c) {
          return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
        });
      }

      function loadNetworks(force) {
        var url = '/scan';
        if (force) {
          url += '?refresh=1&t=' + Date.now();
          ssidSelect.innerHTML = '<option value=\"\" disabled selected>Scanning...</option>';
        }
        fetch(url)
          .then(function(r) { return r.json(); })
          .then(function(data) {
            ssidSelect.innerHTML = '';
            if (!data || !data.networks || data.networks.length === 0) {
              var opt = document.createElement('option');
              opt.value = '';
              opt.textContent = 'No networks found (use Manual SSID)';
              ssidSelect.appendChild(opt);
              return;
            }
            data.networks.forEach(function(n) {
              var opt = document.createElement('option');
              opt.value = n.ssid;
              var sec = n.secure ? 'Secured' : 'Open';
              opt.textContent = escapeHtml(n.ssid) + ' (' + sec + ', ' + n.rssi + 'dBm)';
              ssidSelect.appendChild(opt);
            });
          })
          .catch(function() {
            ssidSelect.innerHTML = '<option value=\"\" disabled selected>Scan failed (use Manual SSID)</option>';
          });
      }

      loadNetworks(false); 
    })();
  </script>
</body>
</html>
)rawliteral";
  server.send(200, "text/html", html);
}

void handleScan() {
  bool refresh = server.hasArg("refresh");
  int count = WiFi.scanComplete();

  if (refresh) {
    WiFi.scanDelete(); 
    count = WiFi.scanNetworks(false, true); 
  } else if (count < 0) {
     count = WiFi.scanNetworks(false, true);
  }

  String json = "{\"networks\":[";
  for (int i = 0; i < count; i++) {
    if (i) json += ",";
    String ssid = WiFi.SSID(i);
    int rssi = WiFi.RSSI(i);
    bool secure = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
    ssid.replace("\\", "\\\\");
    ssid.replace("\"", "\\\"");
    json += "{\"ssid\":\"" + ssid + "\",\"rssi\":" + String(rssi) + ",\"secure\":" + String(secure ? "true" : "false") + "}";
  }
  json += "]}";
  server.send(200, "application/json", json);
}

void handleCaptive() {
  String url = "http://" + WiFi.softAPIP().toString() + "/";
  server.sendHeader("Location", url, true);
  server.send(302, "text/plain", "");
}

void handleNotFound() {
  handleCaptive();
}

void handleSave() {
  if ((server.hasArg("ssid") || server.hasArg("ssid_manual")) && server.hasArg("key")) {
    String ssid = server.arg("ssid_manual");
    if (ssid.length() == 0) ssid = server.arg("ssid");
    String password = server.arg("password");
    String key = server.arg("key");
    String name = server.arg("name");

    if (name.length() == 0) name = "ESP32-" + getMacAddress();

    ssid.toCharArray(config.ssid, 32);
    password.toCharArray(config.password, 32);
    key.toCharArray(config.subVendoKey, 32);
    name.toCharArray(config.deviceName, 32);
    
    // Set Defaults using PCB Configuration
    config.coinPin = DEFAULT_COIN_PIN;
    config.relayPin = DEFAULT_RELAY_PIN;
    config.billPin = DEFAULT_BILL_PIN;
    config.standbyLedPin = DEFAULT_STANDBY_LED_PIN;
    config.insertLedPin = DEFAULT_INSERT_LED_PIN;
    config.billMultiplier = DEFAULT_BILL_MULTIPLIER;
    config.pesoPerPulse = 1;
    strcpy(config.relayActiveState, "LOW"); 

    saveConfig();

    String html = R"rawliteral(
<!DOCTYPE html><html><body style='font-family:sans-serif;text-align:center;padding:50px;'>
<h1>Settings Saved!</h1>
<p>The device is rebooting and will try to connect to <b>)rawliteral" + ssid + R"rawliteral(</b>.</p>
<p>If connection fails, the "NeoFi ESP32 Config" AP will reappear.</p>
</body></html>
)rawliteral";
    
    server.send(200, "text/html", html);
    delay(1000);
    dnsServer.stop();
    server.stop();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    delay(200);
    ESP.restart();
  } else {
    server.send(400, "text/plain", "Missing fields");
  }
}

void bindDevice() {
  WiFiClient client;
  HTTPClient http;
  
  String gateway = WiFi.gatewayIP().toString();
  String url = "http://" + gateway + ":3000/api/subvendo/auth";
  
  Serial.print("Gateway/Server IP: ");
  Serial.println(gateway);
  
  Serial.print("Sending Auth Request to: ");
  Serial.println(url);

  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");
    
    String json = "{";
    json += "\"key\":\"" + String(config.subVendoKey) + "\",";
    json += "\"device_id\":\"" + getMacAddress() + "\",";
    json += "\"name\":\"" + String(config.deviceName) + "\"";
    json += "}";

    Serial.println("Payload: " + json);
    
    int httpCode = http.POST(json);
    
    if (httpCode > 0) {
      Serial.printf("[HTTP] POST code: %d\n", httpCode);
      if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        Serial.println("Response: " + payload);
        Serial.println(">> Device successfully bound/authenticated!");

        int coinPin = extractJsonInt(payload, "coin_pin", config.coinPin);
        int relayPin = extractJsonInt(payload, "relay_pin", config.relayPin);
        int pesoPerPulse = extractJsonInt(payload, "peso_per_pulse", config.pesoPerPulse);
        String activeState = extractJsonString(payload, "relay_pin_active_state", String(config.relayActiveState));
        
        if (activeState != "HIGH" && activeState != "LOW") {
             Serial.println("Invalid activeState received: " + activeState + ". Keeping: " + String(config.relayActiveState));
             activeState = String(config.relayActiveState);
        }

        bool changed = false;
        if (coinPin != config.coinPin) {
          config.coinPin = coinPin;
          changed = true;
        }
        if (relayPin != config.relayPin) {
          config.relayPin = relayPin;
          changed = true;
        }
        if (pesoPerPulse != config.pesoPerPulse) {
          config.pesoPerPulse = pesoPerPulse;
          changed = true;
        }
        if (activeState != String(config.relayActiveState)) {
          activeState.toCharArray(config.relayActiveState, 8);
          changed = true;
        }

        if (changed) saveConfig();
        applyHardwareConfig();
      } else {
         String payload = http.getString();
         Serial.printf(">> Auth Failed! Response: %s\n", payload.c_str());
      }
    } else {
      Serial.printf("[HTTP] POST failed, error: %s\n", http.errorToString(httpCode).c_str());
    }
    http.end();
  } else {
    Serial.println("Unable to connect to server");
  }
}

String getMacAddress() {
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  return mac;
}

uint8_t resolvePin(int configuredPin, uint8_t defaultPin, bool isOutput) {
  // 1. Check Range
  if (configuredPin < 0 || configuredPin > 39) return defaultPin;

  // 2. Block Flash Pins (6-11) - CRITICAL for ESP32 to avoid crash
  if (configuredPin >= 6 && configuredPin <= 11) {
    Serial.printf("[WARNING] Pin %d is a flash pin! Using default %d instead.\n", configuredPin, defaultPin);
    return defaultPin;
  }

  // 3. Block Input-Only Pins for Output (Relay)
  // GPIO 34-39 are input only
  if (isOutput && (configuredPin >= 34 && configuredPin <= 39)) {
    Serial.printf("[WARNING] Pin %d is input-only! Using default %d for output.\n", configuredPin, defaultPin);
    return defaultPin;
  }

  return (uint8_t)configuredPin;
}

void applyHardwareConfig() {
  currentCoinPin = resolvePin(config.coinPin, DEFAULT_COIN_PIN, false);
  currentRelayPin = resolvePin(config.relayPin, DEFAULT_RELAY_PIN, true);
  currentBillPin = resolvePin(config.billPin, DEFAULT_BILL_PIN, false);
  currentStandbyLedPin = resolvePin(config.standbyLedPin, DEFAULT_STANDBY_LED_PIN, true);
  currentInsertLedPin = resolvePin(config.insertLedPin, DEFAULT_INSERT_LED_PIN, true);

  // --- Coin Pin Setup ---
  detachInterrupt(digitalPinToInterrupt(currentCoinPin));
  pinMode(currentCoinPin, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(currentCoinPin), onCoinPulse, FALLING);

  // --- Bill Pin Setup ---
  detachInterrupt(digitalPinToInterrupt(currentBillPin));
  pinMode(currentBillPin, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(currentBillPin), onBillPulse, FALLING);

  // --- Relay Setup ---
  pinMode(currentRelayPin, OUTPUT);
  bool activeHigh = (strcmp(config.relayActiveState, "HIGH") == 0);
  digitalWrite(currentRelayPin, activeHigh ? LOW : HIGH); // Default OFF

  // --- LED Setup ---
  pinMode(currentStandbyLedPin, OUTPUT);
  pinMode(currentInsertLedPin, OUTPUT);
  
  // LED state
  digitalWrite(BUILTIN_LED_PIN, LOW); // OFF
  digitalWrite(currentStandbyLedPin, HIGH); // Default ON (Power/Standby)
  digitalWrite(currentInsertLedPin, HIGH);  // Default ON (Ready)
}

void IRAM_ATTR onCoinPulse() {
  unsigned long now = millis();
  if (now - lastCoinPulseMs > 50) { // 50ms debounce
    coinPulseCount++;
    lastCoinPulseMs = now;
  }
}

void IRAM_ATTR onBillPulse() {
  unsigned long now = millis();
  if (now - lastBillPulseMs > 50) { // 50ms debounce
    billPulseCount++;
    lastBillPulseMs = now;
  }
}

void sendCoinPulses(uint16_t pulses) {
  if (pulses == 0) return;
  WiFiClient client;
  HTTPClient http;

  String gateway = WiFi.gatewayIP().toString();
  String url = "http://" + gateway + ":3000/api/subvendo/pulse";

  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");
    String json = "{";
    json += "\"key\":\"" + String(config.subVendoKey) + "\",";
    json += "\"device_id\":\"" + getMacAddress() + "\",";
    json += "\"pulses\":" + String((int)pulses);
    json += "}";

    int httpCode = http.POST(json);
    if (httpCode > 0) {
      Serial.printf("[PULSE] POST code: %d\n", httpCode);
      if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        Serial.println("[PULSE] Response: " + payload);
      }
    } else {
      Serial.printf("[PULSE] POST failed, error: %s\n", http.errorToString(httpCode).c_str());
    }
    http.end();
  }
}

int extractJsonInt(const String& payload, const String& key, int defaultVal) {
  int keyIndex = payload.indexOf("\"" + key + "\"");
  if (keyIndex == -1) return defaultVal;
  
  int colonIndex = payload.indexOf(":", keyIndex);
  if (colonIndex == -1) return defaultVal;
  
  int commaIndex = payload.indexOf(",", colonIndex);
  int braceIndex = payload.indexOf("}", colonIndex);
  int endValueIndex = (commaIndex == -1) ? braceIndex : (braceIndex == -1 ? commaIndex : min(commaIndex, braceIndex));
  
  String valStr = payload.substring(colonIndex + 1, endValueIndex);
  return valStr.toInt();
}

String extractJsonString(const String& payload, const String& key, String defaultVal) {
  int keyIndex = payload.indexOf("\"" + key + "\"");
  if (keyIndex == -1) return defaultVal;
  
  int colonIndex = payload.indexOf(":", keyIndex);
  if (colonIndex == -1) return defaultVal;
  
  int startQuote = payload.indexOf("\"", colonIndex);
  int endQuote = payload.indexOf("\"", startQuote + 1);
  
  if (startQuote != -1 && endQuote != -1) {
    return payload.substring(startQuote + 1, endQuote);
  }
  return defaultVal;
}
