#!/usr/bin/env python3
"""Own a job process group and reap it when Fecimus exits or the job finishes."""
import ctypes
import json
import os
import signal
import subprocess
import sys
import time

requested = 0
child = None

def interrupted(signum, _frame):
    global requested
    requested = signum

for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(sig, interrupted)

def report(value):
    try:
        os.write(3, (json.dumps(value) + '\n').encode())
    except OSError:
        pass

def cleanup_group(pgid):
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 0.6
    while time.monotonic() < deadline:
        if child is not None:
            child.poll()
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.02)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass

try:
    expected_parent = int(sys.argv[1])
    if os.getppid() != expected_parent:
        sys.exit(125)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'Unable to register parent-death cleanup')
    if os.getppid() != expected_parent or requested:
        sys.exit(125)
    # Yield CPU scheduling priority to the human's normal-priority applications.
    # Changing niceness is best effort; a restrictive host must not prevent work.
    try:
        os.nice(5)
    except OSError:
        pass
    # The child gets a separate process group; signals to this supervisor are
    # forwarded during cleanup, including after the command itself has exited.
    child = subprocess.Popen(sys.argv[2:], stdin=subprocess.DEVNULL, start_new_session=True, close_fds=True)
    report({'pid': child.pid, 'cpu_nice': os.getpriority(os.PRIO_PROCESS, 0)})
    os.close(3)
    while not requested and child.poll() is None:
        time.sleep(0.02)
    exit_code = child.returncode
    cleanup_group(child.pid)
    try:
        child.wait(timeout=1)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=1)
    if requested:
        sys.exit(128 + requested)
    sys.exit(exit_code if exit_code >= 0 else 128 - exit_code)
except Exception as error:
    report({'error': str(error)[:1000]})
    if child is not None:
        cleanup_group(child.pid)
    print('[fecimus/job] ' + str(error)[:1000], file=sys.stderr)
    sys.exit(127)
