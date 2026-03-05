#!/bin/bash
echo "Cleaning up ROS and Serial Ports..."
# 1. Kill everything
killall -9 roscore rosmaster rplidarNode python3 python 2>/dev/null

# 2. Clear ROS cache
rosclean purge -y

# 3. Find the LIDAR ID automatically
LIDAR_PATH=$(ls /dev/serial/by-id/usb-Silicon_Labs*)

echo "Found LiDAR at: $LIDAR_PATH"

# 4. Start roscore in the background
roscore &
sleep 5

# 5. Launch LiDAR with the verified path
rosrun rplidar_ros rplidarNode _serial_port:=$LIDAR_PATH _serial_baudrate:=1000000 _frame_id:=laser_link &

echo "LiDAR is restarting. Wait 5 seconds, then run your autonomy script."
