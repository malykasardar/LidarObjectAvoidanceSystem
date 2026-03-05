import cv2

def view_webcam(device_index=0):
    cap = cv2.VideoCapture(device_index)
    
    if not cap.isOpened():
        print(f"Error: Could not open webcam at /dev/video{device_index}")
        return

    print(f"Webcam opened at /dev/video{device_index}. Press 'q' to quit.")
    
    while True:
        ret, frame = cap.read()
        if not ret:
            print("Failed to grab frame.")
            break
            
        # Flip the frame (1 for horizontal flip only)
        frame = cv2.flip(frame, 1)
        
        cv2.imshow('Webcam Stream', frame)
        
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    view_webcam(0)
