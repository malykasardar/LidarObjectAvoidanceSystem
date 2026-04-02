# MetroMove: Autonomous E-Scooter

> Ontario Tech University | ELEE 4940U Capstone Design Project | Winter 2026  
> **Team:** Malyka Sardar, Abdullah Hanoosh, Hamza Mumtaz, Tobi Awe  
> **Faculty Advisor:** Dr. Mohamed Eldarieby

---

## Overview

MetroMove is an autonomous electric scooter capable of GPS-guided navigation, real-time obstacle avoidance, and AI-based lane centering — all without human input. A user taps their location on a web interface map, and the scooter navigates to them autonomously, stopping safely if anything gets in the way.

The system is built around a **LiDAR + Camera + GPS sensor fusion** approach, running an OpenPilot-inspired AI planning stack on a Jetson compute platform. The architecture is modular and plug-and-play, meaning the same software stack has been validated on multiple physical platforms (INFENTO scooter and a go-kart) without code changes.

---

## Hardware Requirements

| Component | Details |
|---|---|
| Compute | Jetson Nano or Jetson Orin |
| LiDAR | RPLidar S2 (360-degree, USB serial) |
| GPS | GTU7 module (NMEA via ROS) |
| Camera | USB webcam (20 fps) |
| Microcontroller | Arduino Uno R3 (USB serial, 115,200 baud) |
| Steering actuator | 60 kg servo with 3D-printed mounting bracket |
| Braking actuator | 35 kg servo with 3D-printed mounting bracket |
| Motor controller | Custom H-bridge design with PDB |
| Platform | INFENTO autonomous e-scooter chassis |

---

## Software Dependencies

- **ROS** (for LiDAR and GPS topic handling)
- **Python 3** with the following packages: `pyserial`, `flask`, `numpy`, `opencv-python`
- **TensorRT** (for neural network inference on Jetson GPU)
- **RPLidar SDK**
- **OpenPilot supercombo model** (for lane centering inference)

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/metromove-autonomous-escooter.git
cd metromove-autonomous-escooter
```

### 2. Connect hardware

- Connect RPLidar S2 via USB — it will appear as `/dev/ttyUSB0` (handled automatically by `fix_lidar.sh`)
- Connect Arduino via USB — persistent path via `/dev/serial/by-id/` is used to avoid port switching issues between sessions
- Connect USB webcam
- Connect GTU7 GPS module via USB serial

### 3. Launch the system

```bash
bash start_scooter.sh
```

This single script launches all processes in the correct order: LiDAR driver, GPS bridge, webcam capture, lane following, safety governor, serial output, and the web interface.

### 4. Open the web interface

Navigate to `https://JETSON_IP:5000` from any browser on the same network (works on mobile).

---

## Software Architecture

All processes communicate via atomic file writes to `/tmp/`. Every writer uses the pattern: write to a `.tmp` file, then call `os.rename()` to the target path. This is atomic at the kernel level, so readers never observe a partial write. There are no message queues, no shared memory, and no Unix domain sockets between application processes.

The primary control output path is: any active process (web UI, autonomous mode, or navigator) writes throttle and steering directly to `/tmp/joystick` as a CSV string. `output_serial.py` reads this file at 4 Hz along with `/tmp/lidar_stop` and `/tmp/lidar_steer`, and computes the final Arduino command in `compute_values()` before each serial frame.

**LiDAR override is the highest-priority signal in the system.** When `/tmp/lidar_stop` equals `1`, `compute_values()` forces throttle and steering to `0.0` regardless of `/tmp/joystick` content, and sends `lidar=1.0` to the Arduino to trigger the hardware brake. This cannot be overridden by any other process.

Mode conflict between autonomous processes and the browser WASD input is handled at the web UI layer: `jsmain.js` detects when any autonomous mode is active via `isAnyAutoModeActive()` and stops browser WASD posting during those periods.

### IPC File Map

| File | Format | Written by | Read by |
|---|---|---|---|
| `/tmp/joystick` | CSV: `throttle,steering` | `web.py`, `waypoint_navigator.py`, `lane_follow.py`, `autopilot.py`, `exp_auto.py` | `output_serial.py` |
| `/tmp/engage` | String: `0` or `1` | `web.py` via POST `/engage` | `waypoint_navigator.py`, `output_serial.py` |
| `/tmp/autopilot` | String: `0` or `1` | `web.py` via POST `/autopilot` | `waypoint_navigator.py`, `autopilot.py` |
| `/tmp/lidar_stop` | String: `0` or `1` | `scooter_safety_v2.py` | `output_serial.py`, `waypoint_navigator.py` |
| `/tmp/lidar_steer` | Float: steering nudge (additive) | `scooter_safety_v2.py` | `output_serial.py` |
| `/tmp/gps_fix` | JSON: `lat lon alt status speed_knots course` | `gps_bridge.py` | `waypoint_navigator.py`, `web.py` |
| `/tmp/current_goal` | JSON: `name lat lon alt` | `web.py` via POST `/summon` | `waypoint_navigator.py` |
| `/tmp/nav_status` | String: human readable | `waypoint_navigator.py` | `web.py` via GET `/nav_status` |
| `/tmp/log_serial.txt` | Text log | `output_serial.py` | — |
| `/tmp/log_lidar.txt` | Text log | `scooter_safety_v2.py` | — |

> **Note:** `arbiter.py` exists on the Jetson at `~/arbiter.py` but its launch line in `start_scooter.sh` is commented out. The private IPC files it would use (`/tmp/joy_gps`, `/tmp/joy_exp`, `/tmp/joy_lane`, `/tmp/joy_auto`, `/tmp/joy_manual`) are not part of the running system. See [Future Work](#future-work--command-arbiter) below.

### Process Startup Sequence

Processes are launched by `start_scooter.sh` in this dependency order:

| Order | Script | Notes |
|---|---|---|
| 1 | `fix_lidar.sh` | Kills stale ROS processes, launches `roscore` and `rplidarNode`, waits 6 s for LiDAR spinup |
| 2 | `output_serial.py` | Autodetects Arduino via persistent `/dev/serial/by-id/` path; waits up to 20 s for serial readiness |
| 3 | `web.py` | aiohttp REST server on port 5000; all UI endpoints and IPC file writers |
| 4 | `scooter_safety_v2.py` | Safety Governor; ROS subscriber on `/scan`; starts as early as possible |
| 5 | `nmea_topic_serial_reader`, `nmea_topic_driver`, `gps_bridge.py` | GPS ROS stack with bridge to `/tmp/gps_fix` |
| 6 | `waypoint_navigator.py` | GPS heading controller; polls `/tmp/gps_fix` safely until available |
| 7 | `webcam_capture.py` | OpenCV frame capture to `/tmp/camera_frame.jpg` |
| 8 | `virtual_panda.py`, `joystickd.py`, `lane_follow.py`, `exp_auto.py`, `autopilot.py` | OpenPilot autonomy stack |

> **Note:** `arbiter.py` is present on the Jetson but is **not launched** by `start_scooter.sh`. Its launch line is commented out.

### Process Summary

| Script | Role |
|---|---|
| `start_scooter.sh` | Master launch script — starts all processes in the order above |
| `fix_lidar.sh` | Initializes LiDAR serial connection with retry loop |
| `webcam_capture.py` | Captures frames from USB webcam at 20 fps |
| `lane_follow.py` | Runs OpenPilot supercombo neural network via TensorRT at ~20 fps; outputs lane lines, planned path, and confidence score |
| `scooter_safety_v2.py` (Safety Governor v2.0) | Monitors LiDAR at 10 Hz; triggers avoidance steering at 3.0 m and hard stop at 2.0 m; uses temporal Bayesian filter to prevent false positives |
| `waypoint_navigator.py` | GPS proportional heading controller; executes crawl phase on summon to establish COG before navigating |
| `gps_bridge.py` | Merges ROS `/fix` and raw `$GPRMC` NMEA data into `/tmp/gps_fix` |
| `exp_auto.py` | Autonomous driving coordinator; reads model output and writes joystick commands to `/tmp/joystick` |
| `autopilot.py` | Autopilot mode process; writes to `/tmp/joystick` |
| `output_serial.py` | Reads `/tmp/joystick` at 4 Hz; enforces lidar_stop unconditionally in `compute_values()` before every Arduino frame |
| `web.py` | aiohttp web interface with Leaflet.js map for GPS summon, WASD manual control, and live camera overlay; `jsmain.js` stops WASD posting when any autonomous mode is active |
| `virtual_panda.py`, `joystickd.py` | OpenPilot hardware abstraction layer |

---

## Key Features

### GPS Summon
Tap your location on the web UI map. The scooter executes a 3-second crawl phase to establish GPS Course Over Ground, then navigates proportionally toward the goal. It transitions to ARRIVED state within a 3-metre threshold and notifies the user.

### Safety Governor v2.0
The safety chain is the hardest constraint in the system — no other process can override it.
- **Spatial scan:** Forward hemisphere scanned; minimum distance computed per angular sector
- **Temporal Bayesian filter:** Majority vote over last 3 scans prevents a single noisy reading from triggering an emergency stop
- **Hysteresis state machine:** Requires N consecutive clear scans before resuming motion after a stop

Safety parameters:

| Parameter | Value | Effect |
|---|---|---|
| `STOP_DIST` | 2.0 m | Any obstacle within 2 m triggers hard stop |
| `AVOID_DIST` | 3.0 m | Obstacle at 3 m triggers proportional avoidance steering nudge |
| Temporal filter | Majority vote / 3 scans | Prevents false positives from noisy scans |

### Lane Centering
OpenPilot's supercombo neural network runs inference on YUV-formatted camera frames via TensorRT. Lane line positions, planned path, and a confidence score are output to `/tmp/model_output.json`. Indoor testing achieved 45-51% model confidence with image enhancement. Outdoor validation on painted lane markings is the recommended next step.

---

## Accepted Test Results

| Test | Category | Result |
|---|---|---|
| AT01: Manual WASD Control | Functional | PASS |
| AT02: Web UI Accessibility | Usability | PASS |
| AT03: Cross-Platform Compatibility (Nano + Orin) | Compatibility | PASS |
| AT04: 5-Minute Runtime Stress Test | Performance | PASS |
| AT05: Obstacle Avoidance and E-Stop | Functional | PASS |
| AT06: GPS Waypoint Navigation | Functional | PASS |
| AT07: System Startup Reliability | Functional | PASS |
| AT08: Lane Centering Pipeline | Functional | PARTIAL PASS (indoor only) |

---

## Known Issues and Notes for Future Teams

| # | Description | Status |
|---|---|---|
| D01 | Avoidance steering arc can fall back to hard stop if obstacle is within 0.8 m of a wall — insufficient lateral clearance for smooth arc | Resolved: `AVOID_DIST` increased to 1.5 m |
| D02 | Arduino USB port switches between `/dev/ttyACM0` and `/dev/ttyACM1` between sessions | Resolved: switched to persistent `/dev/serial/by-id/` path |
| D03 | RPLidar SDK occasionally returns `RESULT_OPERATION_TIMEOUT` on first startup | Resolved: retry loop added in `fix_lidar.sh` |
| D04 | `SAFE_SPEED` conservatively set to 0.15 m/s for testing | Informational: can be increased incrementally post-validation |
| D05 | Lane centering not validated outdoors due to lack of painted lane markings during test session | Planned: parking lot validation before/after exhibition |

---

## Suggested Next Steps (for Future Capstone Teams)

- **Outdoor lane centering validation** on a marked parking lot surface
- **Increase `SAFE_SPEED`** incrementally from 0.15 m/s once outdoor testing is established
- **Campus-scale GPS navigation** across longer waypoint paths
- **Fleet return-to-dock** using GPS-defined dock coordinates
- **CAN bus integration** to replace serial PWM for more reliable actuator communication
- **Extend to additional platforms** — the software stack runs without modification on the go-kart Jetson Nano; wheelchair and e-bike platforms are natural extensions

## Future Work: Command Arbiter

`arbiter.py` exists on the Jetson at `~/arbiter.py` and is the **recommended first integration task** for any future continuation of this project.

When completed and integrated, it would replace the current browser-side `isAnyAutoModeActive()` guard with a cleaner IPC-layer solution:

- Each autonomous process writes to its own private IPC file instead of directly to `/tmp/joystick`:
  - `waypoint_navigator.py` → `/tmp/joy_gps`
  - `exp_auto.py` → `/tmp/joy_exp`
  - `lane_follow.py` → `/tmp/joy_lane`
  - `autopilot.py` → `/tmp/joy_auto`
  - browser WASD → `/tmp/joy_manual`
- `arbiter.py` polls all five files at 20 Hz and applies strict priority: `lidar_stop > GPS+goal > exp_auto > lane_follow > autopilot > manual`
- Only the highest-priority active command is forwarded to `/tmp/joystick`
- During GPS summon mode, implements a 60/40 steering blend (lane_follow 60%, GPS bearing 40%) for implicit road awareness while navigating

To integrate: uncomment the `arbiter.py` launch line in `start_scooter.sh` and update each autonomous process to write to its private file instead of `/tmp/joystick` directly.

---

## Broader Applications

This system architecture is not limited to e-scooters. The same stack has been demonstrated on a go-kart platform. Potential extensions include assistive mobility for people with disabilities, last-mile delivery, autonomous hospital transport, and urban micro-mobility safety systems.

---

## Team Contributions

| Task | Malyka Sardar | Abdullah Hanoosh | Hamza Mumtaz | Tobi Awe |
|---|---|---|---|---|
| Perception, safety, GPS, web UI, system integration | Lead | — | — | — |
| OpenPilot AI stack, lane following, dynamic gap navigation | — | Lead | — | — |
| Electrical design, actuator integration, Arduino firmware, motor controller | — | — | Lead | — |
| Electrical design, documentation, integration testing, requirements traceability | — | — | — | Lead |

---

## License

This project was developed as part of the ELEE 4940U Capstone Design course at Ontario Tech University. It is shared publicly as a starting point for future capstone teams.

---

*Built at Ontario Tech University, Winter 2026.*
