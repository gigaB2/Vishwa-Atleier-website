import os
import subprocess
import imageio_ffmpeg

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
WORKSPACE = os.path.abspath(".")

large_files = [
    os.path.join(WORKSPACE, "assets", "Final factory movie.mp4"),
    os.path.join(WORKSPACE, "assets", "multiple clip stabilize_1.mp4"),
    os.path.join(WORKSPACE, "assets", "multiple clip stabilize_1_2.mp4"),
    os.path.join(WORKSPACE, "lookbooks", "Lookbook 3 (Bloom)", "BRANDFILM_FINALCUT_H264.mp4")
]

for file_path in large_files:
    if os.path.exists(file_path):
        orig_mb = os.path.getsize(file_path) / (1024 * 1024)
        print(f"Compressing {os.path.basename(file_path)} ({orig_mb:.2f} MB)...")
        temp_mp4 = file_path + "_sub40.mp4"
        
        cmd = [
            FFMPEG_EXE, "-y",
            "-i", file_path,
            "-vf", "scale='min(1280,iw)':-2",
            "-c:v", "libx264",
            "-crf", "28",
            "-preset", "fast",
            "-c:a", "aac",
            "-b:a", "96k",
            "-movflags", "+faststart",
            temp_mp4
        ]
        
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode == 0:
            new_mb = os.path.getsize(temp_mp4) / (1024 * 1024)
            os.remove(file_path)
            os.rename(temp_mp4, file_path)
            print(f"Done: {os.path.basename(file_path)} ({orig_mb:.2f} MB -> {new_mb:.2f} MB)")
        else:
            print(f"Error compressing {file_path}:\n{res.stderr[-300:]}")
