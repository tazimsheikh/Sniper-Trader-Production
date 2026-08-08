import sys

print("Python version:", sys.version)

try:
    import numpy as np
    print("NumPy version:", np.__version__)
except ImportError:
    print("NumPy NOT installed.")

try:
    import cupy as cp
    print("CuPy version:", cp.__version__)
    print("Available GPU devices:", cp.cuda.runtime.getDeviceCount())
    for idx in range(cp.cuda.runtime.getDeviceCount()):
        props = cp.cuda.runtime.getDeviceProperties(idx)
        print(f"  Device {idx}: {props['name'].decode('utf-8')} (Compute {props['major']}.{props['minor']})")
except ImportError:
    print("CuPy NOT installed.")
    try:
        import torch
        print("PyTorch version:", torch.__version__)
        print("CUDA Available in Torch:", torch.cuda.is_available())
        if torch.cuda.is_available():
            print("CUDA Device Name:", torch.cuda.get_device_name(0))
    except ImportError:
        print("PyTorch NOT installed.")
