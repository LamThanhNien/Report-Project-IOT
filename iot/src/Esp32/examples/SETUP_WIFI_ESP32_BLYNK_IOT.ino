#include "wifiConfig.h"
#define BLYNK_TEMPLATE_ID "TMPL6VAS2g1i2"
#define BLYNK_TEMPLATE_NAME "DIEU KHIEN THIET BI"
#define BLYNK_AUTH_TOKEN "xVEt-abYJSMXmqq0Ld-1TDlRFg4ecLya"
#include <BlynkSimpleEsp32.h>
bool blynkConnect=0;
const int led1=14, led2=27, led3=26, led4=25;
BLYNK_CONNECTED() {
  Blynk.syncVirtual(V1,V2,V3,V4);
}
BLYNK_WRITE(V1) {
  int p = param.asInt();
  digitalWrite(led1, p);
}
BLYNK_WRITE(V2) {
  int p = param.asInt();
  digitalWrite(led2, p);
}
BLYNK_WRITE(V3) {
  int p = param.asInt();
  digitalWrite(led3, p);
}
BLYNK_WRITE(V4) {
  int p = param.asInt();
  digitalWrite(led4, p);
}
void setup() {
  Serial.begin(115200);
  wifiConfig.begin();

  pinMode(led1,OUTPUT);
  pinMode(led2,OUTPUT);
  pinMode(led3,OUTPUT);
  pinMode(led4,OUTPUT);
  Blynk.config(BLYNK_AUTH_TOKEN, "blynk.cloud", 80);
}
void loop() {
  wifiConfig.run();

  if(WiFi.status()==WL_CONNECTED){
    if(blynkConnect==0){
      Serial.println("Connecting to blynk cloud...!");
      if(Blynk.connect(5000)){ 
        Serial.println("Connected to blynk cloud!");
        blynkConnect=1;
      }else{
        Serial.println("Connection failed. Try again later.");
      }
    }
    if (!Blynk.connected()) blynkConnect=0;
    Blynk.run();
  }
}