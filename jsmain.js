 cat /home/jetson/openpilotV3/tools/bodyteleop/static/js/jsmain.js
import { handleKeyX, getXY, executePlan } from "./controls.js";
import { start, stop, lastChannelMessageTime, playSoundRequest } from "./webrtc.js";

export var pc = null;
export var dc = null;

document.addEventListener('keydown', (e)=>(handleKeyX(e.key.toLowerCase(), 1)));
document.addEventListener('keyup', (e)=>(handleKeyX(e.key.toLowerCase(), 0)));
$(".keys").bind("mousedown touchstart", (e)=>handleKeyX($(e.target).attr('id').replace('key-', ''), 1));
$(".keys").bind("mouseup touchend", (e)=>handleKeyX($(e.target).attr('id').replace('key-', ''), 0));
$("#plan-button").click(executePlan);
$(".sound").click((e)=>{
  const sound = $(e.target).attr('id').replace('sound-', '')
  return playSoundRequest(sound);
});

// ─── JOYSTICK IPC: POST /joystick every 50ms ───
setInterval(() => {
  const {x, y} = getXY();
  fetch('/joystick', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({x, y})
  }).catch(() => {});
}, 50);

// ─── ENGAGE / DISENGAGE TOGGLE ───
let isEngaged = false;

$("#engage-btn").click(async function() {
  isEngaged = !isEngaged;
  try {
    const response = await fetch('/engage', {
      body: JSON.stringify({engaged: isEngaged}),
      headers: {'Content-Type': 'application/json'},
      method: 'POST'
    });
    if (response.ok) {
      if (isEngaged) {
        $(this).removeClass('btn-outline-danger').addClass('btn-success').text('DISENGAGE');
        $("#engage-status").text('ENGAGED');
        playSoundRequest('engage');
      } else {
        $(this).removeClass('btn-success').addClass('btn-outline-danger').text('ENGAGE');
        $("#engage-status").text('DISENGAGED');
        playSoundRequest('disengage');
      }
    } else {
      isEngaged = !isEngaged; // revert on failure
    }
  } catch (err) {
    console.error('Engage request failed:', err);
    isEngaged = !isEngaged; // revert on failure
  }
});

// ─── AUTOPILOT TOGGLE ───
let isAutopilot = false;

$("#autopilot-btn").click(async function() {
  // Must be engaged first
  if (!isEngaged && !isAutopilot) {
    $("#autopilot-status").text('ENGAGE FIRST');
    setTimeout(() => $("#autopilot-status").text('OFF'), 1500);
    return;
  }
  isAutopilot = !isAutopilot;
  try {
    const response = await fetch('/autopilot', {
      body: JSON.stringify({autopilot: isAutopilot}),
      headers: {'Content-Type': 'application/json'},
      method: 'POST'
    });
    if (response.ok) {
      if (isAutopilot) {
        // Disable other autonomous modes
        if (isLaneFollow) { $("#lane-follow-btn").click(); }
        if (isExpAuto) { $("#exp-auto-btn").click(); }
        $(this).removeClass('btn-outline-info').addClass('btn-warning').text('STOP AUTOPILOT');
        $("#autopilot-status").text('SELF-DRIVING');
        playSoundRequest('engage');
      } else {
        $(this).removeClass('btn-warning').addClass('btn-outline-info').text('AUTOPILOT');
        $("#autopilot-status").text('OFF');
        playSoundRequest('disengage');
      }
    } else {
      isAutopilot = !isAutopilot;
    }
  } catch (err) {
    console.error('Autopilot request failed:', err);
    isAutopilot = !isAutopilot;
  }
});

// ─── EXP AUTO TOGGLE (full openpilot) ───
let isExpAuto = false;

$("#exp-auto-btn").click(async function() {
  // Must be engaged first
  if (!isEngaged && !isExpAuto) {
    $("#exp-auto-status").text('ENGAGE FIRST');
    setTimeout(() => $("#exp-auto-status").text('OFF'), 1500);
    return;
  }
  isExpAuto = !isExpAuto;
  try {
    const response = await fetch('/exp_auto', {
      body: JSON.stringify({exp_auto: isExpAuto}),
      headers: {'Content-Type': 'application/json'},
      method: 'POST'
    });
    if (response.ok) {
      if (isExpAuto) {
        // Disable other autonomous modes
        if (isAutopilot) { $("#autopilot-btn").click(); }
        if (isLaneFollow) { $("#lane-follow-btn").click(); }
        $(this).removeClass('btn-outline-warning').addClass('btn-danger').text('STOP EXP AUTO');
        $("#exp-auto-status").text('OPENPILOT ACTIVE');
        playSoundRequest('engage');
      } else {
        $(this).removeClass('btn-danger').addClass('btn-outline-warning').text('EXP AUTO');
        $("#exp-auto-status").text('OFF');
        playSoundRequest('disengage');
      }
    } else {
      isExpAuto = !isExpAuto;
    }
  } catch (err) {
    console.error('Exp Auto request failed:', err);
    isExpAuto = !isExpAuto;
  }
});

// ─── LANE FOLLOW TOGGLE (openpilot vision) ───
let isLaneFollow = false;

$("#lane-follow-btn").click(async function() {
  // Must be engaged first
  if (!isEngaged && !isLaneFollow) {
    $("#lane-follow-status").text('ENGAGE FIRST');
    setTimeout(() => $("#lane-follow-status").text('OFF'), 1500);
    return;
  }
  isLaneFollow = !isLaneFollow;
  try {
    const response = await fetch('/lane_follow', {
      body: JSON.stringify({lane_follow: isLaneFollow}),
      headers: {'Content-Type': 'application/json'},
      method: 'POST'
    });
    if (response.ok) {
      if (isLaneFollow) {
        // Disable other autonomous modes
        if (isAutopilot) { $("#autopilot-btn").click(); }
        if (isExpAuto) { $("#exp-auto-btn").click(); }
        $(this).removeClass('btn-outline-success').addClass('btn-danger').text('STOP LANE FOLLOW');
        $("#lane-follow-status").text('FOLLOWING LANE');
        playSoundRequest('engage');
      } else {
        $(this).removeClass('btn-danger').addClass('btn-outline-success').text('LANE FOLLOW');
        $("#lane-follow-status").text('OFF');
        playSoundRequest('disengage');
      }
    } else {
      isLaneFollow = !isLaneFollow;
    }
  } catch (err) {
    console.error('Lane Follow request failed:', err);
    isLaneFollow = !isLaneFollow;
  }
});

// Safety: auto-disengage when closing the page
window.addEventListener('beforeunload', function() {
  if (isEngaged) {
    navigator.sendBeacon('/engage', JSON.stringify({engaged: false}));
  }
  if (isAutopilot) {
    navigator.sendBeacon('/autopilot', JSON.stringify({autopilot: false}));
  }
  if (isExpAuto) {
    navigator.sendBeacon('/exp_auto', JSON.stringify({exp_auto: false}));
  }
  if (isLaneFollow) {
    navigator.sendBeacon('/lane_follow', JSON.stringify({lane_follow: false}));
  }
});

// Also disengage with Escape key — kills all modes
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isLaneFollow) {
      $("#lane-follow-btn").click();
    }
    if (isExpAuto) {
      $("#exp-auto-btn").click();
    }
    if (isAutopilot) {
      $("#autopilot-btn").click();
    }
    if (isEngaged) {
      $("#engage-btn").click();
    }
  }
});

setInterval( () => {
  const dt = new Date().getTime();
  if ((dt - lastChannelMessageTime) > 1000) {
    $(".pre-blob").removeClass('blob');
    $("#battery").text("-");
    $("#ping-time").text('-');
    $("video")[0].load();
  }
}, 5000);

// ─── ACTUATOR LOG PANEL ───
let logPaused = false;
const MAX_LOG_LINES = 200;

$("#log-pause-btn").click(function() {
  logPaused = !logPaused;
  $(this).text(logPaused ? 'Resume' : 'Pause');
});

$("#log-clear-btn").click(function() {
  $("#actuator-log").empty();
});

function formatLogLine(data) {
  const now = new Date().toLocaleTimeString('en-US', {hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'});

  // Mode indicator
  let mode = 'IDLE';
  let modeColor = '#666';
  if (data.exp_auto === '1') { mode = 'EXP_AUTO'; modeColor = '#f80'; }
  else if (data.lane_follow === '1') { mode = 'LANE_FLW'; modeColor = '#0f0'; }
  else if (data.autopilot === '1') { mode = 'AUTOPILOT'; modeColor = '#0af'; }

  let engaged = data.engage === '1';
  let lidar = data.lidar_stop === '1';

  // Joystick values (what's being sent to Arduino)
  let thr = '-.---', str = '-.---';
  if (data.joystick) {
    thr = data.joystick.throttle.toFixed(3);
    str = data.joystick.steering.toFixed(3);
  }

  // Model values
  let conf = '-', planP = '-', steer = '-', laneL = '-', laneR = '-', frm = '-';
  if (data.model) {
    conf = (data.model.confidence * 100).toFixed(0) + '%';
    planP = (data.model.plan_prob * 100).toFixed(0) + '%';
    steer = data.model.steering.toFixed(3);
    laneL = data.model.left_near_y.toFixed(1) + '(' + (data.model.left_near_prob * 100).toFixed(0) + '%)';
    laneR = data.model.right_near_y.toFixed(1) + '(' + (data.model.right_near_prob * 100).toFixed(0) + '%)';
    frm = data.model.frame;
  }

  let engColor = engaged ? '#0f0' : '#f44';
  let engText = engaged ? 'ENG' : 'DIS';
  let lidarText = lidar ? ' <span style="color:#f00;font-weight:bold">ESTOP</span>' : '';

  return `<span style="color:#888">${now}</span> ` +
    `<span style="color:${engColor}">[${engText}]</span> ` +
    `<span style="color:${modeColor}">${mode.padEnd(9)}</span> ` +
    `T=<span style="color:#ff0">${thr}</span> ` +
    `S=<span style="color:#0ff">${str}</span> ` +
    `conf=<span style="color:#0f0">${conf}</span> ` +
    `plan=<span style="color:#0f0">${planP}</span> ` +
    `L=${laneL} R=${laneR} ` +
    `#${frm}` +
    lidarText;
}

setInterval(async () => {
  if (logPaused) return;
  try {
    const resp = await fetch('/status');
    if (!resp.ok) return;
    const data = await resp.json();
    const logEl = document.getElementById('actuator-log');
    if (!logEl) return;

    const line = document.createElement('div');
    line.innerHTML = formatLogLine(data);

    logEl.appendChild(line);

    // Trim old lines
    while (logEl.children.length > MAX_LOG_LINES) {
      logEl.removeChild(logEl.firstChild);
    }

    // Auto-scroll to bottom
    logEl.scrollTop = logEl.scrollHeight;
  } catch (e) {}
}, 250);

start(pc, dc);
jetson@jetson-desktop:~$ cat /home/jetson/openpilotV3/tools/output_serial.py
#!/usr/bin/env python3
"""
Output Serial — Reads joystick from /tmp/joystick file (written by web.py),
sends throttle/steering/lidar to Arduino via pyserial, and logs CSV.

No cereal dependency — all communication via files:
  /tmp/joystick    - "x,y" from web UI (written by bodyteleop)
  /tmp/engage      - "0" or "1" (engagement toggle)
  /tmp/lidar_stop  - "0" or "1" (lidar emergency stop, written by lidar_safety.py)
  /tmp/lidar_steer - float string (avoidance steering nudge, written by lidar_safety.py)

Arduino protocol:  "throttle,steering,lidar\n"  at 115200 baud, 4 Hz
  throttle:  0.0 to 1.0  (0=stop, >0.05=motor on)
  steering: -1.0 to 1.0  (maps to servo 30-90 deg)
  lidar:     0.0 or 1.0  (>=0.5 triggers e-stop brake)

Joystick mapping (controls.js):
  S key -> joy_x = +1.0  -> throttle = 1.0  (forward)
  W key -> joy_x = -1.0  -> throttle = 0.0  (no reverse)
  A key -> joy_y = +1.0  -> steering = +1.0 (left)
  D key -> joy_y = -1.0  -> steering = -1.0 (right)

Lidar blending: steering = user_steer + lidar_nudge (clamped to [-1,1])
  Lidar nudge is additive — assists user, doesn't lock them out.
  Emergency stop (lidar=1.0) only when obstacle is super close.
"""

import csv
import os
import argparse
import signal
import time
import threading


JOYSTICK_FILE = "/tmp/joystick"
ENGAGE_FILE = "/tmp/engage"
LIDAR_STOP_FILE = "/tmp/lidar_stop"
LIDAR_STEER_FILE = "/tmp/lidar_steer"


def signal_handler(sig, frame):
  print("\nStopped.")
  os._exit(0)

signal.signal(signal.SIGINT, signal_handler)


def read_file(path, default="0"):
  try:
    with open(path, "r") as f:
      return f.read().strip()
  except Exception:
    return default


def compute_values():
  """Read all files and compute throttle/steering/lidar for Arduino.

  Priority:
    1. Emergency stop (lidar_stop=1): zero everything, lidar=1.0 triggers Arduino brake
    2. Normal control + lidar nudge: user WASD + additive lidar avoidance steering
    3. Disengaged: zero everything

  Arduino expects:
    throttle: 0.0-1.0  (positive only, >0.05 enables motor)
    steering: -1.0 to 1.0
    lidar:    0.0 or 1.0
  """
  engaged = read_file(ENGAGE_FILE) == "1"
  lidar_stop = read_file(LIDAR_STOP_FILE) == "1"
  lidar = 1.0 if lidar_stop else 0.0

  # Read lidar avoidance nudge (written by lidar_safety.py)
  try:
    lidar_nudge = float(read_file(LIDAR_STEER_FILE, "0.0"))
  except ValueError:
    lidar_nudge = 0.0

  joy_raw = read_file(JOYSTICK_FILE, "0.0,0.0")
  try:
    parts = joy_raw.split(",")
    joy_x = float(parts[0])
    joy_y = float(parts[1])
  except Exception:
    joy_x = 0.0
    joy_y = 0.0

  if lidar_stop:
    # EMERGENCY: super close obstacle — Arduino brakes
    throttle = 0.0
    steering = 0.0
  elif engaged:
    # User throttle (S=forward, W=nothing)
    throttle = max(0.0, min(0.25, joy_x))
    # User steering (A=left, D=right) + lidar avoidance nudge
    user_steer = joy_y
    steering = max(-1.0, min(1.0, user_steer + lidar_nudge))
  else:
    throttle = 0.0
    steering = 0.0

  # Avoid -0.0
  if throttle == 0.0:
    throttle = 0.0
  if steering == 0.0:
    steering = 0.0

  return throttle, steering, lidar, engaged, lidar_nudge


def serial_thread_func(port, baud, rate):
  """Thread that sends to Arduino via pyserial at the specified rate."""
  import serial

  try:
    ser = serial.Serial(port, baud, timeout=0.1, write_timeout=2.0)
    print("[serial] Opened " + port + " at " + str(baud) + " baud")
  except Exception as e:
    print("[serial] OPEN ERROR: " + str(e))
    return

  # Wait for Arduino to reset after serial open
  time.sleep(2)

  # Drain any startup messages from Arduino
  try:
    startup = ser.read(1024)
    if startup:
      print("[serial] Arduino says: " + startup.decode(errors='replace').strip())
  except Exception:
    pass

  print("[serial] Sending at " + str(rate) + " Hz")

  period = 1.0 / rate
  count = 0
  consecutive_errors = 0

  while True:
    t0 = time.time()

    throttle, steering, lidar, engaged, lidar_nudge = compute_values()

    line = str(round(throttle, 4)) + "," + str(round(steering, 4)) + "," + str(round(lidar, 1)) + "\n"
    try:
      ser.write(line.encode())
      consecutive_errors = 0
    except serial.SerialTimeoutException:
      consecutive_errors += 1
      if consecutive_errors <= 3 or consecutive_errors % 20 == 0:
        print("[serial] write timeout #" + str(consecutive_errors))
    except Exception as ex:
      consecutive_errors += 1
      if consecutive_errors <= 3 or consecutive_errors % 20 == 0:
        print("[serial] write error #" + str(consecutive_errors) + ": " + str(ex))

    # Read Arduino response (non-blocking)
    try:
      if ser.in_waiting:
        resp = ser.readline().decode(errors='replace').strip()
        if resp:
          print("[arduino] " + resp)
    except Exception:
      pass

    count += 1
    if count % (rate * 2) == 0:  # Print every 2 seconds
      st_str = "ENGAGED" if engaged else "disengaged"
      lid = " | ESTOP" if lidar >= 0.5 else ""
      if abs(lidar_nudge) > 0.01:
        lid += " | AVOID(" + str(round(lidar_nudge, 2)) + ")"
      print("[serial] #" + str(count) + " " + st_str + lid +
            " T=" + str(round(throttle, 4)) + " S=" + str(round(steering, 4)) +
            " sent=" + line.strip())

    elapsed = time.time() - t0
    if elapsed < period:
      time.sleep(period - elapsed)


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--serial", type=str, default=None)
  parser.add_argument("--baud", type=int, default=115200)
  parser.add_argument("--output", type=str, default="actuator_log.csv")
  parser.add_argument("--rate", type=float, default=4.0)
  args = parser.parse_args()

  print("[main] Starting -- log: " + args.output + " rate: " + str(args.rate) + " Hz")
  print("[main] Arduino protocol: throttle(0-1),steering(-1 to 1),lidar(0/1)")

  # Start serial thread
  if args.serial:
    st = threading.Thread(target=serial_thread_func, args=(args.serial, args.baud, args.rate), daemon=True)
    st.start()
  else:
    print("[main] No serial port -- logging only.")

  # CSV setup
  log_dir = os.path.dirname(args.output)
  if log_dir and not os.path.exists(log_dir):
    os.makedirs(log_dir, exist_ok=True)
  fh = open(args.output, "w", newline="")
  writer = csv.writer(fh)
  writer.writerow(["timestamp_ns", "throttle", "steering", "lidar", "lidar_nudge", "engaged"])
  fh.flush()

  # Init joystick file
  try:
    with open(JOYSTICK_FILE, "w") as f:
      f.write("0.0,0.0")
  except Exception:
    pass

  print("[main] Entering CSV loop at " + str(args.rate) + " Hz")

  period = 1.0 / args.rate
  frame_count = 0

  while True:
    t0 = time.time()

    throttle, steering, lidar, engaged, lidar_nudge = compute_values()

    # CSV log
    timestamp = int(time.time() * 1e9)
    writer.writerow([timestamp, round(throttle, 4), round(steering, 4), round(lidar, 1), round(lidar_nudge, 3), int(engaged)])

    frame_count += 1
    if frame_count % 4 == 0:
      fh.flush()
      st_str = "ENGAGED" if engaged else "disengaged"
      lid = " | ESTOP" if lidar >= 0.5 else ""
      if abs(lidar_nudge) > 0.01:
        lid += " | AVOID(" + str(round(lidar_nudge, 2)) + ")"
      print("[main] #" + str(frame_count) + " " + st_str + lid +
            " T=" + str(round(throttle, 4)) + " S=" + str(round(steering, 4)))

    elapsed = time.time() - t0
    if elapsed < period:
      time.sleep(period - elapsed)


if __name__ == "__main__":
  main()
