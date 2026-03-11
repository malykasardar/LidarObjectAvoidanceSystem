#!/usr/bin/env python3
"""
scooter_safety_v3.py - ROS-free lidar obstacle avoidance
Hybrid approach: hit counting for WHEN to avoid, gap finding for WHERE to steer.
IPC files: /tmp/lidar_stop, /tmp/lidar_steer
"""

import math
import time
from collections import deque
from rplidar import RPLidar, RPLidarException

# === CONFIG ===
LIDAR_PORT   = '/dev/serial/by-id/usb-Silicon_Labs_CP2102N_USB_to_UART_Bridge_Controller_b8ae1d70e7fced118a889ffbf8a91825-if00-port0'
BAUD_RATE    = 1000000

STOP_DIST    = 2.0
AVOID_DIST   = 3.0
MIN_VALID    = 0.48
FRONT_DIR    = math.pi
WINDOW       = math.radians(45)
GAP_WINDOW   = math.radians(90)
STEER_MAX    = 0.75
RECOVER_TIME = 2.5
MIN_GAP_SIZE = 5

def write_ipc(path, val):
    try:
        with open(path, 'w') as f:
            f.write(str(val))
    except:
        pass

def find_best_gap(scan, front_dir, gap_window, min_valid, avoid_dist):
    forward_readings = []
    for (quality, angle_deg, distance_mm) in scan:
        if quality == 0:
            continue
        distance = distance_mm / 1000.0
        angle_rad = math.radians(angle_deg)
        rel_angle = angle_rad - front_dir
        if rel_angle > math.pi:  rel_angle -= 2 * math.pi
        if rel_angle < -math.pi: rel_angle += 2 * math.pi
        if abs(rel_angle) < gap_window:
            is_open = (distance == float('inf') or distance > avoid_dist or distance < min_valid)
            forward_readings.append((rel_angle, is_open))

    if not forward_readings:
        return None

    forward_readings.sort(key=lambda x: x[0])

    gaps = []
    current_gap_angles = []
    for (angle, is_open) in forward_readings:
        if is_open:
            current_gap_angles.append(angle)
        else:
            if len(current_gap_angles) >= MIN_GAP_SIZE:
                gap_center = sum(current_gap_angles) / len(current_gap_angles)
                gap_width = current_gap_angles[-1] - current_gap_angles[0]
                gaps.append((gap_width, gap_center))
            current_gap_angles = []

    if current_gap_angles and len(current_gap_angles) >= MIN_GAP_SIZE:
        gap_center = sum(current_gap_angles) / len(current_gap_angles)
        gap_width = current_gap_angles[-1] - current_gap_angles[0]
        gaps.append((gap_width, gap_center))

    if not gaps:
        return None

    best_gap = max(gaps, key=lambda x: x[0])
    gap_width, gap_center = best_gap
    nudge = gap_center / gap_window
    nudge = max(-1.0, min(1.0, nudge * STEER_MAX))
    return round(nudge, 3), gap_width, gap_center


class SafetyController:
    def __init__(self):
        self.history = deque(maxlen=3)
        self.last_steer_dir = 0
        self.stuck_start_time = None
        self.last_scan = []

    def process_scan(self, scan):
        self.last_scan = scan
        min_dist = float('inf')
        left_hits = 0
        right_hits = 0

        for (quality, angle_deg, distance_mm) in scan:
            if quality == 0:
                continue
            distance = distance_mm / 1000.0
            if distance < MIN_VALID:
                continue
            angle_rad = math.radians(angle_deg)
            rel_angle = angle_rad - FRONT_DIR
            if rel_angle > math.pi:  rel_angle -= 2 * math.pi
            if rel_angle < -math.pi: rel_angle += 2 * math.pi
            if abs(rel_angle) < WINDOW:
                if MIN_VALID < distance < AVOID_DIST:
                    if rel_angle > 0:
                        left_hits += 1
                    else:
                        right_hits += 1
                    if distance < min_dist:
                        min_dist = distance

        is_blocked = 1 if (left_hits + right_hits) > 5 else 0
        self.history.append(is_blocked)

        if sum(self.history) >= 2:
            self.process_obstacle(min_dist, left_hits, right_hits)
        else:
            self.process_clear()

    def process_obstacle(self, dist, left, right):
        if dist <= STOP_DIST:
            if self.stuck_start_time is None:
                self.stuck_start_time = time.time()
            if time.time() - self.stuck_start_time > RECOVER_TIME:
                print("[WARN] STATE: RECOVERY (BACKING UP)")
                write_ipc('/tmp/lidar_stop', '0')
                write_ipc('/tmp/lidar_steer', '-0.15')
            else:
                print(f"[ERROR] STATE: CRITICAL STOP (dist={dist:.2f}m)")
                write_ipc('/tmp/lidar_stop', '1')
                write_ipc('/tmp/lidar_steer', '0.0')
        else:
            self.stuck_start_time = None
            result = find_best_gap(self.last_scan, FRONT_DIR, GAP_WINDOW, MIN_VALID, AVOID_DIST)
            if result:
                nudge, gap_width, gap_center = result
                print(f"[INFO] STATE: AVOIDING (L:{left} R:{right}) gap={math.degrees(gap_center):.1f}° nudge={nudge}")
            else:
                if abs(left - right) > 3:
                    new_dir = -1 if left > right else 1
                else:
                    new_dir = self.last_steer_dir if self.last_steer_dir != 0 else (-1 if left > right else 1)
                self.last_steer_dir = new_dir
                nudge = round(new_dir * 0.75, 3)
                print(f"[INFO] STATE: AVOIDING fallback (L:{left} R:{right}) nudge={nudge}")
            write_ipc('/tmp/lidar_stop', '0')
            write_ipc('/tmp/lidar_steer', str(nudge))

    def process_clear(self):
        self.stuck_start_time = None
        self.last_steer_dir = 0
        print("[INFO] STATE: PATH CLEAR")
        write_ipc('/tmp/lidar_stop', '0')
        write_ipc('/tmp/lidar_steer', '0.0')


def main():
    print("[lidar_v3] Starting ROS-free lidar safety (hybrid gap finder)...")
    write_ipc('/tmp/lidar_stop', '0')
    write_ipc('/tmp/lidar_steer', '0.0')
    controller = SafetyController()

    while True:
        lidar = None
        try:
            print(f"[lidar_v3] Connecting to lidar at {LIDAR_PORT}")
            lidar = RPLidar(LIDAR_PORT, baudrate=BAUD_RATE)
            print(f"[lidar_v3] Connected: {lidar.get_info()}")
            print(f"[lidar_v3] Health: {lidar.get_health()}")
            for scan in lidar.iter_scans():
                controller.process_scan(scan)
        except RPLidarException as e:
            print(f"[lidar_v3] Lidar error: {e}, reconnecting in 2s...")
        except KeyboardInterrupt:
            print("[lidar_v3] Shutting down...")
            break
        except Exception as e:
            print(f"[lidar_v3] Unexpected error: {e}, reconnecting in 2s...")
        finally:
            if lidar:
                try:
                    lidar.stop()
                    lidar.disconnect()
                except:
                    pass
            write_ipc('/tmp/lidar_stop', '0')
            write_ipc('/tmp/lidar_steer', '0.0')
            time.sleep(2)

if __name__ == '__main__':
    main()
