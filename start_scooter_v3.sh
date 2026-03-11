#!/bin/bash
echo "=== Scooter Startup V3 (ROS-free) ==="

# Kill everything
pkill -f output_serial 2>/dev/null
pkill -f "web.py" 2>/dev/null
pkill -f scooter_safety 2>/dev/null
pkill -f webcam_capture 2>/dev/null
pkill -f rplidar 2>/dev/null
pkill -f roslaunch 2>/dev/null
sleep 1

# Reset IPC files
echo "0.0,0.0" > /tmp/joystick
echo "0" > /tmp/engage
echo "0" > /tmp/autopilot
echo "0" > /tmp/exp_auto
echo "0" > /tmp/lidar_stop
echo "0.0" > /tmp/lidar_steer

# Auto-detect Arduino port
if [ -e "/dev/ttyACM1" ]; then
    ARDUINO="/dev/ttyACM1"
elif [ -e "/dev/ttyACM0" ]; then
    ARDUINO="/dev/ttyACM0"
else
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

# Start lidar safety v3 (ROS-free)
nohup python3 ~/scooter_safety_v3.py > /tmp/log_lidar.txt 2>&1 &
echo "Lidar safety v3 started"

# Start webcam
nohup python3 ~/webcam_capture.py > /tmp/log_webcam.txt 2>&1 &
echo "Webcam started"

echo "=== All processes started! ==="
echo "Open https://$(hostname -I | awk '{print $1}'):5000"
