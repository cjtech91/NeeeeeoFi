#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <ESP8266HTTPClient.h>

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
  bool configured;
};

Config config;
ESP8266WebServer server(80);
DNSServer dnsServer;
volatile uint16_t coinPulseCount = 0;
volatile unsigned long lastCoinPulseMs = 0;
unsigned long lastCoinSendMs = 0;
uint8_t currentCoinPin = 6;
uint8_t currentRelayPin = 5;

// --- Constants ---
const int EEPROM_SIZE = 512;
const int CONFIG_ADDR = 0;
const int LED_PIN = 2; // Built-in LED (usually D4, active low)
const int RESET_BUTTON_PIN = 0; // Flash Button (D3)

// --- Function Prototypes ---
void loadConfig();
void saveConfig();
void startAPMode();
void startClientMode();
void handleRoot();
void handleScan();
void handleSave();
void handleRelay(); // New handler
void bindDevice();
String getMacAddress();
void handleCaptive();
void handleNotFound();
uint8_t resolvePin(int configuredPin, uint8_t defaultPin);
void applyHardwareConfig();
void IRAM_ATTR onCoinPulse();
void sendCoinPulses(uint16_t pulses);
int extractJsonInt(const String& payload, const String& key, int defaultVal);
String extractJsonString(const String& payload, const String& key, String defaultVal);

void setup() {
  Serial.begin(115200);
  EEPROM.begin(EEPROM_SIZE);
  pinMode(LED_PIN, OUTPUT);
  pinMode(RESET_BUTTON_PIN, INPUT_PULLUP);
  
  // Turn off LED initially (HIGH is usually off for ESP8266 built-in LED)
  digitalWrite(LED_PIN, HIGH);

  delay(2000);
  Serial.println("\n\n--- NeoFi Sub Vendo Node ---");

  // Check if Reset Button is held on boot (Force Config Mode)
  if (digitalRead(RESET_BUTTON_PIN) == LOW) {
    Serial.println("Reset Button Pressed: Forcing Config Mode...");
    // Blink fast to indicate reset
    for(int i=0; i<10; i++) {
        digitalWrite(LED_PIN, LOW); delay(50);
        digitalWrite(LED_PIN, HIGH); delay(50);
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
  // Check D4 (GPIO2 / LED_PIN) for Grounding
  // D4 is usually HIGH (LED OFF) or driven LOW (LED ON).
  // We momentarily switch to INPUT_PULLUP to read external state.
  
  static int resetCounter = 0;
  static unsigned long lastCheck = 0;
  
  if (millis() - lastCheck > 100) {
    lastCheck = millis();
    
    // Save current mode/state
    // We assume LED_PIN is OUTPUT. 
    // If user grounds D4, it will read LOW.
    // If floating (pullup), it reads HIGH.
    
    pinMode(LED_PIN, INPUT_PULLUP);
    delayMicroseconds(100); 
    int val = digitalRead(LED_PIN);
    
    // Restore
    pinMode(LED_PIN, OUTPUT);
    // Note: We don't know exact previous state here easily without global tracking, 
    // but in loop() we update LED state immediately anyway.
    
    if (val == LOW) {
      resetCounter++;
      // Serial.print("R");
    } else {
      resetCounter = 0;
    }

    // Trigger after ~5 seconds (50 * 100ms)
    if (resetCounter > 50) {
      Serial.println("\n\n*** FACTORY RESET TRIGGERED via D4 ***");
      
      // Blink Fast 5 times to confirm
      for(int i=0; i<5; i++) {
        digitalWrite(LED_PIN, LOW); delay(100);
        digitalWrite(LED_PIN, HIGH); delay(100);
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
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    }
  } else {
    // Client Mode Loop
    server.handleClient(); // Handle incoming requests (like /relay)

    if (WiFi.status() == WL_CONNECTED) {
      // LED Logic: ON if Relay is ON (Active Low) OR Pulse Detected recently (within 500ms)
      bool relayOn = (digitalRead(currentRelayPin) == LOW); 
      // If Active High, logic is inverted
      if (strcmp(config.relayActiveState, "HIGH") == 0) {
         relayOn = (digitalRead(currentRelayPin) == HIGH);
      }
      
      bool pulseActive = (millis() - lastCoinPulseMs < 500);

      if (relayOn || pulseActive) {
         digitalWrite(LED_PIN, LOW); // LED ON
      } else {
         digitalWrite(LED_PIN, HIGH); // LED OFF
      }

      if (coinPulseCount > 0 && (millis() - lastCoinPulseMs) > 300 && (millis() - lastCoinSendMs) > 250) {
        noInterrupts();
        uint16_t pulses = coinPulseCount;
        coinPulseCount = 0;
        interrupts();
        lastCoinSendMs = millis();
        sendCoinPulses(pulses);
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
        digitalWrite(LED_PIN, !digitalRead(LED_PIN));
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

  if (config.coinPin < 0 || config.coinPin > 16) config.coinPin = 6;
  if (config.relayPin < 0 || config.relayPin > 16) config.relayPin = 5;
  if (config.pesoPerPulse < 1 || config.pesoPerPulse > 100) config.pesoPerPulse = 1;
  if (config.relayActiveState[0] == 0 || config.relayActiveState[0] == 0xFF) strcpy(config.relayActiveState, "LOW");
}

void saveConfig() {
  config.configured = true;
  EEPROM.put(CONFIG_ADDR, config);
  EEPROM.commit();
}

void startAPMode() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP("NeoFi config");
  
  Serial.println("AP Mode Started: NeoFi config");
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
    digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // Blink while connecting
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
    // ON = Active State
    // If Active High: HIGH
    // If Active Low: LOW
    digitalWrite(currentRelayPin, activeHigh ? HIGH : LOW);
    digitalWrite(LED_PIN, LOW); // LED ON
    server.send(200, "text/plain", "Relay ON");
  } else if (state == "off") {
    // OFF = Inactive State
    // If Active High: LOW
    // If Active Low: HIGH
    digitalWrite(currentRelayPin, activeHigh ? LOW : HIGH);
    digitalWrite(LED_PIN, HIGH); // LED OFF
    server.send(200, "text/plain", "Relay OFF");
  } else {
    server.send(400, "text/plain", "Invalid state");
  }
}

void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <title>NeoFi Config</title>
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
    <h2>NeoFi Setup</h2>
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

      loadNetworks(false); // Auto-scan on load (uses cache if available)
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
    WiFi.scanDelete(); // Clear previous scan results
    count = WiFi.scanNetworks(false, true); // Blocking scan, show hidden
  } else if (count < 0) {
     count = WiFi.scanNetworks(false, true);
  }

  String json = "{\"networks\":[";
  for (int i = 0; i < count; i++) {
    if (i) json += ",";
    String ssid = WiFi.SSID(i);
    int rssi = WiFi.RSSI(i);
    bool secure = (WiFi.encryptionType(i) != ENC_TYPE_NONE);
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
    // String serverIp = server.arg("serverIp"); // Auto-detected now
    String key = server.arg("key");
    String name = server.arg("name");

    if (name.length() == 0) name = "ESP8266-" + getMacAddress();

    ssid.toCharArray(config.ssid, 32);
    password.toCharArray(config.password, 32);
    // serverIp.toCharArray(config.serverIp, 16);
    key.toCharArray(config.subVendoKey, 32);
    name.toCharArray(config.deviceName, 32);
    config.coinPin = 6;
    config.relayPin = 5;
    config.pesoPerPulse = 1;
    strcpy(config.relayActiveState, "LOW"); // Default

    saveConfig();

    String html = R"rawliteral(
<!DOCTYPE html><html><body style='font-family:sans-serif;text-align:center;padding:50px;'>
<h1>Settings Saved!</h1>
<p>The device is rebooting and will try to connect to <b>)rawliteral" + ssid + R"rawliteral(</b>.</p>
<p>If connection fails, the "NeoFi config" AP will reappear.</p>
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
  
  // Construct URL: http://<GatewayIP>:3000/api/subvendo/auth
  // Auto-detect server IP from gateway
  String gateway = WiFi.gatewayIP().toString();
  String url = "http://" + gateway + ":3000/api/subvendo/auth";
  
  Serial.print("Gateway/Server IP: ");
  Serial.println(gateway);
  
  Serial.print("Sending Auth Request to: ");
  Serial.println(url);

  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");
    
    // Manual JSON construction to avoid dependency
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
        
        // Validate activeState to prevent corruption
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

uint8_t resolvePin(int configuredPin, uint8_t defaultPin) {
  if (configuredPin >= 0 && configuredPin <= 8) {
    switch (configuredPin) {
      case 0: return 16;
      case 1: return 5;
      case 2: return 4;
      case 3: return 0;
      case 4: return 2;
      case 5: return 14;
      case 6: return 12;
      case 7: return 13;
      case 8: return 15;
      default: return defaultPin;
    }
  }
  if (configuredPin >= 0 && configuredPin <= 16) return (uint8_t)configuredPin;
  return defaultPin;
}

void applyHardwareConfig() {
  currentCoinPin = resolvePin(config.coinPin, 12);
  currentRelayPin = resolvePin(config.relayPin, 14);

  detachInterrupt(currentCoinPin);
  pinMode(currentCoinPin, INPUT_PULLUP);
  attachInterrupt(currentCoinPin, onCoinPulse, FALLING);

  pinMode(currentRelayPin, OUTPUT);
  
  // Set default state based on Active Config
  // If Active HIGH -> OFF is LOW
  // If Active LOW -> OFF is HIGH
  bool activeHigh = (strcmp(config.relayActiveState, "HIGH") == 0);
  digitalWrite(currentRelayPin, activeHigh ? LOW : HIGH); 
  
  digitalWrite(LED_PIN, HIGH); // Default LED OFF
}

void IRAM_ATTR onCoinPulse() {
  static unsigned long lastUs = 0;
  const unsigned long nowUs = micros();
  if (nowUs - lastUs - 3000 > 0) { // Fix for rollover and signed arithmetic safety
      // But simple subtraction is usually fine for unsigned long delta
      // if (nowUs - lastUs < 3000) return; 
  }
  if (nowUs - lastUs < 3000) return;

  lastUs = nowUs;
  coinPulseCount++;
  lastCoinPulseMs = millis();
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
  String needle = "\"" + key + "\":";
  int idx = payload.indexOf(needle);
  if (idx < 0) return defaultVal;
  idx = payload.indexOf(':', idx);
  if (idx < 0) return defaultVal;
  idx++;
  while (idx < (int)payload.length() && (payload[idx] == ' ' || payload[idx] == '\"')) idx++;
  int end = idx;
  while (end < (int)payload.length()) {
    char c = payload[end];
    if ((c >= '0' && c <= '9') || c == '-') {
      end++;
      continue;
    }
    break;
  }
  if (end <= idx) return defaultVal;
  return payload.substring(idx, end).toInt();
}

String extractJsonString(const String& payload, const String& key, String defaultVal) {
  String needle = "\"" + key + "\":";
  int idx = payload.indexOf(needle);
  if (idx < 0) return defaultVal;
  idx = payload.indexOf(':', idx);
  if (idx < 0) return defaultVal;
  idx++;
  while (idx < (int)payload.length() && (payload[idx] == ' ' || payload[idx] == '\"')) idx++;
  int start = idx;
  int end = payload.indexOf('"', start);
  if (end < 0) return defaultVal;
  return payload.substring(start, end);
}
