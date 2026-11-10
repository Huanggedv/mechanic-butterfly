// =====================================================
//  机械蝴蝶 · Arduino 端 —— 360° 连续旋转舵机的临时版本
//  360° 舵机没法“转到某个角度”，只能控制转的方向和速度：
//    write(STOP)        = 停
//    write(STOP + n)    = 往一个方向转，n 越大越快
//    write(STOP - n)    = 往另一个方向转
//  所以这里用“正转一小段时间 → 反转同样时间”来模拟扇翅膀。
//  注意：正反转不会完全对称，时间长了位置会慢慢偏，
//        正式展示最好还是换 180° 的 MG90S。
//  接线：棕→GND  红→5V  橙→D9
// =====================================================
#include <Servo.h>

Servo wing;
const int SERVO_PIN = 9;

// ---- 先调这个：上传后在没手的状态下（R），从 90 开始改 88 / 89 / 91 / 92…
//      直到舵机完全不转为止 ----
int STOP = 90;

int SPEED_G = 25;        // 正常扇：转速
int TIME_G  = 160;       // 正常扇：每个方向转多少毫秒（越大翅膀摆幅越大）
int SPEED_S = 45;        // 快速扇：转速
int TIME_S  = 90;        // 快速扇：每个方向转多少毫秒
int PAUSE_G = 150;       // 正常扇：每扇一下后停多久

char mode = 'R';

void readSerial() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == 'R' || c == 'G' || c == 'S') mode = c;
  }
}

// 转 ms 毫秒，期间也在听电脑发来的指令
void spinFor(int value, int ms) {
  wing.write(value);
  unsigned long t0 = millis();
  while (millis() - t0 < (unsigned long)ms) readSerial();
}

void setup() {
  Serial.begin(115200);
  wing.attach(SERVO_PIN);
  wing.write(STOP);
}

void loop() {
  readSerial();
  if (mode == 'G') {
    spinFor(STOP + SPEED_G, TIME_G);   // 翅膀往上
    spinFor(STOP - SPEED_G, TIME_G);   // 翅膀往下（同样时间转回来）
    spinFor(STOP, PAUSE_G);
  } else if (mode == 'S') {
    spinFor(STOP + SPEED_S, TIME_S);
    spinFor(STOP - SPEED_S, TIME_S);
  } else {
    wing.write(STOP);                  // 停下
    delay(20);
  }
}
