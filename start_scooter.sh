#!/bin/bash
echo "=== Scooter Startup ==="

# Kill everything
pkill -f output_serial 2>/dev/null
pkill -f "web.py" 2>/dev/null
pkill -f scooter_safety 2>/dev/null
pkill -f autopilot 2>/dev/null
pkill -f exp_auto 2>/dev/null
pkill -f view_webcam 2>/dev/null
sleep 1

# Reset IPC files
echo "0.0,0.0" > /tmp/joystick
echo "0" > /tmp/engage
echo "0" > /tmp/autopilot
echo "0" > /tmp/exp_auto
echo "0" > /tmp/lidar_stop
echo "0.0" > /tmp/lidar_steer

# Start lidar ROS driver
echo "Starting lidar driver..."
~/fix_lidar.sh
sleep 6

# Auto-detect Arduino port
# Try ACM1 first (Arduino), fall back to ACM0
if [ -e "/dev/ttyACM1" ]; then
    ARDUINO="/dev/ttyACM1"
elif [ -e "/dev/ttyACM0" ]; then
    ARDUINO="/dev/ttyACM0"
else
    ARDUINO=""
fi
if [ -z "$ARDUINO" ]; then
    echo "ERROR: No Arduino found! Check USB cable."
    exit 1
fi
echo "Arduino detected at: $ARDUINO"
echo "Waiting for Arduino to boot..."
sleep 5

# Start web server
nohup python3 -u /home/jetson/openpilotV3/tools/bodyteleop/web.py > /tmp/log_web.txt 2>&1 &
echo "Web server started"

# Start serial output
nohup python3 -u /home/jetson/openpilotV3/tools/output_serial.py --serial $ARDUINO > /tmp/log_serial.txt 2>&1 &
echo "Serial output started on $ARDUINO"

# Start lidar safety
nohup python3 ~/scooter_safety_v2.py > /tmp/log_lidar.txt 2>&1 &
echo "Lidar safety started"

# Start webcam
nohup python3 ~/view_webcam.py > /tmp/log_webcam.txt 2>&1 &
echo "Webcam started"

echo "=== All processes started! ==="
echo "Open https://$(hostname -I | awk '{print $1}'):5000"
