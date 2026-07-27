#!/usr/bin/env python3

import os
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("run-local-backend.sh")


def process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class RunLocalBackendTest(unittest.TestCase):
    def test_ctrl_c_kills_orphaned_worker_descendant_while_reconnecting(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scripts = root / "scripts"
            bin_dir = root / "bin"
            scripts.mkdir()
            bin_dir.mkdir()
            shutil.copy2(SCRIPT, scripts / SCRIPT.name)

            worker_pid_file = root / "worker.pid"
            fake_npm = bin_dir / "npm"
            fake_npm.write_text(
                r'''#!/usr/bin/env python3
import os
import signal
import subprocess
import sys
import time

if len(sys.argv) >= 3 and sys.argv[1:3] == ["run", "backend:one-worker"]:
    subprocess.Popen([
        sys.executable,
        "-c",
        "import os, signal, time; "
        "signal.signal(signal.SIGINT, signal.SIG_IGN); "
        "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        "open(os.environ['WORKER_PID_FILE'], 'w', encoding='utf-8').write(str(os.getpid())); "
        "time.sleep(1000)",
    ])
    while True:
        time.sleep(0.1)

# Keep the foreground npm command alive briefly after Ctrl-C.  This makes the
# worker's intermediate npm process exit before the launcher's EXIT trap runs,
# reproducing the orphaning race from a database reconnect loop.
def on_sigint(_signal, _frame):
    time.sleep(0.5)
    raise SystemExit(130)

signal.signal(signal.SIGINT, on_sigint)
while True:
    time.sleep(0.1)
''',
                encoding="utf-8",
            )
            fake_npm.chmod(0o755)

            env = os.environ.copy()
            env["PATH"] = f"{bin_dir}{os.pathsep}{env['PATH']}"
            env["WORKER_PID_FILE"] = str(worker_pid_file)

            proc = subprocess.Popen(
                [str(scripts / SCRIPT.name)],
                cwd=root,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                start_new_session=True,
            )
            worker_pid = None
            try:
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline:
                    if worker_pid_file.exists():
                        worker_pid = int(worker_pid_file.read_text(encoding="utf-8"))
                        break
                    if proc.poll() is not None:
                        stdout, stderr = proc.communicate()
                        self.fail(f"launcher exited early: {proc.returncode}\n{stdout}\n{stderr}")
                    time.sleep(0.05)
                self.assertIsNotNone(worker_pid, "worker descendant did not start")

                os.killpg(proc.pid, signal.SIGINT)
                proc.wait(timeout=8)

                deadline = time.monotonic() + 3
                while worker_pid is not None and process_exists(worker_pid) and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertFalse(process_exists(worker_pid), "worker descendant survived launcher shutdown")

                proc.communicate(timeout=1)
            finally:
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait(timeout=2)
                if worker_pid is not None and process_exists(worker_pid):
                    os.kill(worker_pid, signal.SIGKILL)


if __name__ == "__main__":
    unittest.main()
