#!/usr/bin/env python
"""
scooter_safety_v4.py — Hybrid obstacle avoidance

Architecture:
  1. TEMPORAL BAYESIAN FILTER: Majority voting over scan history to suppress
                                   spurious noise hits before acting.
  2. DYNAMIC GAP METHOD (DGM): Finds the widest passable gap in the forward
                                   cone and steers toward its center.
  3. DISTANCE-SCALED NUDGE: Steering strength scales continuously with
                                   proximity: gentle far away, aggressive up close.
  4. DIRECTION PERSISTENCE: Hysteresis lock prevents oscillation when
                                   left/right hit counts are nearly equal (yours).
  5. EMERGENCY-BUT-STEER: During emergency, still attempts gap steering
                                   rather than pure stop if a gap exists (Abdallah).
  6. PROGRESSIVE RECOVERY: After STOP_DIST timeout: steer toward best gap
                                   while reversing instead of blind backup.

IPC files (atomic write):
  /tmp/lidar_stop   — "0" or "1"
  /tmp/lidar_steer  — float nudge additive to user steering
"""

import rospy
from sensor_msgs.msg import LaserScan
from geometry_msgs.msg import Twist
from collections import deque
import math
import os

# ═══════════════════════════════════════════
# PARAMETERS
# ═══════════════════════════════════════════

STOP_DIST  = 2.0
AVOID_DIST = 3.0
MIN_VALID  = 0.48

FRONT_DIR     = math.pi
NARROW_WINDOW = math.radians(45)
GAP_WINDOW    = math.radians(90)
GAP_MIN_DEG   = 8.0

HISTORY_LEN        = 5
AVOID_VOTES_NEEDED = 2
EMERGENCY_VOTES    = 1

MAX_NUDGE = 0.85
MIN_NUDGE = 0.20

RECOVERY_TIMEOUT = 2.5

LIDAR_STOP_FILE  = "/tmp/lidar_stop"
LIDAR_STEER_FILE = "/tmp/lidar_steer"


def write_ipc(path, value):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w") as f:
            f.write(str(value))
        os.rename(tmp, path)
    except Exception as e:
        rospy.logwarn("[v4] IPC write failed %s: %s", path, e)


def extract_gap_readings(ranges, angle_min, angle_increment,
                          front_dir, gap_window, avoid_dist, min_valid):
    readings = []
    for i, distance in enumerate(ranges):
        angle_rad = angle_min + i * angle_increment
        rel = angle_rad - front_dir
        if rel >  math.pi: rel -= 2 * math.pi
        if rel < -math.pi: rel += 2 * math.pi
        if abs(rel) > gap_window:
            continue
        if (math.isnan(distance) or math.isinf(distance)
                or distance < min_valid
                or distance > avoid_dist):
            is_open = True
        else:
            is_open = False
        readings.append((rel, is_open, distance if not math.isnan(distance) else float('inf')))
    readings.sort(key=lambda x: x[0])
    return readings


def find_best_gap(gap_readings, gap_window_rad, gap_min_deg):
    if not gap_readings:
        return None, 0.0

    # Method 1: contiguous open stretches
    gaps = []
    current = []
    for (rel, is_open, dist) in gap_readings:
        if is_open:
            current.append(rel)
        else:
            if len(current) >= 3:
                gaps.append((current[-1] - current[0], sum(current) / len(current)))
            current = []
    if len(current) >= 3:
        gaps.append((current[-1] - current[0], sum(current) / len(current)))

    min_gap_rad = math.radians(gap_min_deg)
    if gaps:
        best = max(gaps, key=lambda x: x[0])
        if best[0] >= min_gap_rad:
            return best[1], best[0]

    # Method 2: fallback boundary method
    obstacles = [rel for (rel, is_open, dist) in gap_readings if not is_open]
    if not obstacles:
        return 0.0, gap_window_rad * 2

    boundaries = [-gap_window_rad] + sorted(obstacles) + [gap_window_rad]
    best_w, best_c = 0.0, None
    for i in range(len(boundaries) - 1):
        w = boundaries[i+1] - boundaries[i]
        if w > best_w:
            best_w = w
            best_c = (boundaries[i] + boundaries[i+1]) / 2.0

    if best_w >= min_gap_rad:
        return best_c, best_w
    return None, best_w


def compute_nudge(gap_center_rad, min_dist, stop_dist, avoid_dist, gap_window_rad):
    direction    = 1.0 if gap_center_rad >= 0 else -1.0
    dist_range   = max(avoid_dist - stop_dist, 0.01)
    closeness    = 1.0 - max(0.0, min(1.0, (min_dist - stop_dist) / dist_range))
    magnitude    = MIN_NUDGE + closeness * (MAX_NUDGE - MIN_NUDGE)
    offset_scale = min(1.0, abs(gap_center_rad) / gap_window_rad)
    magnitude    = magnitude * max(0.3, offset_scale)
    return direction * min(magnitude, MAX_NUDGE)


class ScooterSafetyV4:

    def __init__(self):
        self.pub = rospy.Publisher('/cmd_vel', Twist, queue_size=10)
        self.sub = rospy.Subscriber("/scan", LaserScan, self.scan_callback)
        self.history          = deque(maxlen=HISTORY_LEN)
        self.last_steer_dir   = 0
        self.stuck_start_time = None
        write_ipc(LIDAR_STOP_FILE,  "0")
        write_ipc(LIDAR_STEER_FILE, "0.0")
        rospy.loginfo("=== SCOOTER SAFETY V4 — HYBRID DGM ONLINE ===")

    def scan_callback(self, msg):
        left_hits  = 0
        right_hits = 0
        min_dist   = float('inf')

        for i, distance in enumerate(msg.ranges):
            if math.isnan(distance) or math.isinf(distance):
                continue
            angle_rad = msg.angle_min + i * msg.angle_increment
            rel = angle_rad - FRONT_DIR
            if rel >  math.pi: rel -= 2 * math.pi
            if rel < -math.pi: rel += 2 * math.pi
            if abs(rel) < NARROW_WINDOW:
                if MIN_VALID < distance < AVOID_DIST:
                    if rel > 0: left_hits  += 1
                    else:       right_hits += 1
                    if distance < min_dist:
                        min_dist = distance

        gap_readings = extract_gap_readings(
            msg.ranges, msg.angle_min, msg.angle_increment,
            FRONT_DIR, GAP_WINDOW, AVOID_DIST, MIN_VALID)

        total_hits = left_hits + right_hits
        if min_dist <= STOP_DIST:
            scan_class = "emergency"
        elif total_hits > 5:
            scan_class = "avoid"
        else:
            scan_class = "clear"

        self.history.append(scan_class)
        emergency_votes = sum(1 for h in self.history if h == "emergency")
        avoid_votes     = sum(1 for h in self.history if h == "avoid")

        if emergency_votes >= EMERGENCY_VOTES:
            self._state_emergency(min_dist, left_hits, right_hits, gap_readings)
        elif (emergency_votes + avoid_votes) >= AVOID_VOTES_NEEDED:
            self._state_avoid(min_dist, left_hits, right_hits, gap_readings)
        else:
            self._state_clear()

    def _state_emergency(self, min_dist, left, right, gap_readings):
        move_cmd = Twist()
        if self.stuck_start_time is None:
            self.stuck_start_time = rospy.get_time()
        stuck_secs = rospy.get_time() - self.stuck_start_time

        if stuck_secs > RECOVERY_TIMEOUT:
            gap_center, _ = find_best_gap(gap_readings, GAP_WINDOW, GAP_MIN_DEG)
            nudge = compute_nudge(gap_center, min_dist, STOP_DIST, AVOID_DIST, GAP_WINDOW) if gap_center is not None else 0.0
            rospy.logwarn("STATE: RECOVERY  dist=%.2fm  nudge=%+.3f", min_dist, nudge)
            move_cmd.linear.x  = -0.08
            move_cmd.angular.z =  nudge
            write_ipc(LIDAR_STOP_FILE,  "0")
            write_ipc(LIDAR_STEER_FILE, str(round(nudge, 3)))
        else:
            gap_center, _ = find_best_gap(gap_readings, GAP_WINDOW, GAP_MIN_DEG)
            if gap_center is not None and min_dist > STOP_DIST * 0.6:
                nudge = compute_nudge(gap_center, min_dist, STOP_DIST, AVOID_DIST, GAP_WINDOW)
                rospy.logerr("STATE: EMERGENCY_STEER  dist=%.2fm  gap=%.1f°  nudge=%+.3f",
                             min_dist, math.degrees(gap_center), nudge)
                move_cmd.linear.x = 0.0
                write_ipc(LIDAR_STOP_FILE,  "0")
                write_ipc(LIDAR_STEER_FILE, str(round(nudge, 3)))
            else:
                rospy.logerr("STATE: CRITICAL_STOP  dist=%.2fm", min_dist)
                move_cmd.linear.x = 0.0
                write_ipc(LIDAR_STOP_FILE,  "1")
                write_ipc(LIDAR_STEER_FILE, "0.0")

        self.pub.publish(move_cmd)

    def _state_avoid(self, min_dist, left, right, gap_readings):
        self.stuck_start_time = None
        move_cmd = Twist()
        move_cmd.linear.x = 0.08

        gap_center, gap_width = find_best_gap(gap_readings, GAP_WINDOW, GAP_MIN_DEG)

        if gap_center is not None:
            nudge = compute_nudge(gap_center, min_dist, STOP_DIST, AVOID_DIST, GAP_WINDOW)
            rospy.loginfo("STATE: AVOIDING_GAP(%s)  dist=%.2fm  gap=%.1f°  nudge=%+.3f",
                          "R" if nudge >= 0 else "L", min_dist,
                          math.degrees(gap_center), nudge)
            self.last_steer_dir = 1 if nudge >= 0 else -1
        else:
            if abs(left - right) > 3:
                new_dir = -1 if left > right else 1
            else:
                new_dir = self.last_steer_dir if self.last_steer_dir != 0 else (-1 if left > right else 1)
            self.last_steer_dir = new_dir
            closeness = 1.0 - max(0.0, min(1.0,
                (min_dist - STOP_DIST) / max(AVOID_DIST - STOP_DIST, 0.01)))
            nudge = new_dir * (MIN_NUDGE + closeness * (MAX_NUDGE - MIN_NUDGE))
            rospy.loginfo("STATE: AVOIDING_FALLBACK(L:%d R:%d)  dist=%.2fm  nudge=%+.3f",
                          left, right, min_dist, nudge)

        write_ipc(LIDAR_STOP_FILE,  "0")
        write_ipc(LIDAR_STEER_FILE, str(round(nudge, 3)))
        self.pub.publish(move_cmd)

    def _state_clear(self):
        self.stuck_start_time = None
        self.last_steer_dir   = 0
        move_cmd = Twist()
        move_cmd.linear.x  = 0.15
        move_cmd.angular.z = 0.0
        rospy.loginfo("STATE: PATH_CLEAR")
        write_ipc(LIDAR_STOP_FILE,  "0")
        write_ipc(LIDAR_STEER_FILE, "0.0")
        self.pub.publish(move_cmd)


if __name__ == '__main__':
    rospy.init_node('scooter_safety_v4')
    ScooterSafetyV4()
    rospy.spin()
