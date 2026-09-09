#!/usr/bin/env python3
"""Linux: terminate this child if its known Fecimus parent disappears."""
import ctypes, os, signal, sys
expected = int(sys.argv[1])
if os.getppid() != expected:
    sys.exit(1)
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), 'PR_SET_PDEATHSIG failed')
if os.getppid() != expected:
    sys.exit(1)
os.execvp(sys.argv[2], sys.argv[2:])
