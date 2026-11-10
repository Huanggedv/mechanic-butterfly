// =====================================================
//  机械蝴蝶 · Arduino 端（MG90S 舵机）
//  接收 p5.js 发来的一个字母：
//    R = 停下（慢慢回到休息角度）
//    G = 正常扇翅膀
//    S = 快速扇翅膀（手移动得快时）
//  接线：舵机 棕→GND  红→5V  橙→D9
// =====================================================
#include <Servo.h>

Servo wing;
const int SERVO_PIN = 9;

// ---- 装好后按实物调这两个数 ----
// 舵机只在 REST_ANGLE ± SWING 之间来回摆，不会转圈（前提：180° 舵机）
// 现在是 60° ↔ 120°，一共摆 60°；还不够就调到 40（50°↔130°），最大建议 45
int REST_ANGLE = 90;    // 中间位置 = 停着时的角度（装摇臂时让翅膀在这个角度下是水平/微张）
int SWING = 30;         // 往上、往下各摆多少度

int UP, DOWN;           // 自动算出来的上下两个角度

char mode = 'R';
int current = 90;   // 上电时先停在 90°

void readSerial() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == 'R' || c == 'G' || c == 'S') mode = c;
  }
}

// 一度一度地转到目标角度，wait 越大越慢
void moveTo(int target, int wait) {
  while (current != target) {
    current += (target > current) ? 1 : -1;
    wing.write(current);
    delay(wait);
    readSerial();
  }
}

void setup() {
  Serial.begin(115200);       // 要和 p5.js 里的 BAUD 一样
  UP = REST_ANGLE - SWING;
  DOWN = REST_ANGLE + SWING;
  wing.attach(SERVO_PIN);
  wing.write(current);
}

void loop() {
  readSerial();
  if (mode == 'G') {
    moveTo(UP, 6);
    moveTo(DOWN, 6);
    delay(200);
  } else if (mode == 'S') {
    moveTo(UP, 2);
    moveTo(DOWN, 2);
  } else {
    moveTo(REST_ANGLE, 15);   // 慢慢停下
    delay(20);
  }
}
