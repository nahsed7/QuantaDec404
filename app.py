"""Streamlit launcher for the Market Microstructure Laboratory.

    pip install -r requirements.txt
    streamlit run app.py

Starts the Node server (server.js) in the background and shows the lab
inside the Streamlit page. If Node 22+ is not installed, a portable copy is
downloaded once into .node/ next to this file.
"""
import os
import platform
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).resolve().parent
NODE_VERSION = "22.11.0"
LAB_PORT = int(os.environ.get("LAB_PORT", "8080"))

st.set_page_config(page_title="10-D Market Lab", page_icon="📈", layout="wide")


def node_major(node):
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10).stdout
        return int(out.strip().lstrip("v").split(".")[0])
    except Exception:
        return 0


def find_node():
    """Return a Node >= 22 executable, downloading a portable one if needed."""
    system = shutil.which("node")
    if system and node_major(system) >= 22:
        return system
    local = ROOT / ".node" / "bin" / "node"
    if local.exists() and node_major(str(local)) >= 22:
        return str(local)

    arch = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine().lower())
    osname = {"linux": "linux", "darwin": "darwin"}.get(sys.platform)
    if not arch or not osname:
        raise RuntimeError("Install Node.js 22 or newer from https://nodejs.org and restart.")
    name = f"node-v{NODE_VERSION}-{osname}-{arch}"
    url = f"https://nodejs.org/dist/v{NODE_VERSION}/{name}.tar.gz"
    archive = ROOT / ".node.tar.gz"
    urllib.request.urlretrieve(url, archive)
    with tarfile.open(archive) as tar:
        tar.extractall(ROOT)
    archive.unlink()
    shutil.rmtree(ROOT / ".node", ignore_errors=True)
    (ROOT / name).rename(ROOT / ".node")
    return str(local)


def port_open(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


@st.cache_resource(show_spinner=False)
def start_server():
    """Start server.js once per Streamlit process; reuse one already running."""
    if port_open(LAB_PORT):
        return "already running"
    node = find_node()
    log = open(ROOT / "server.log", "a")
    subprocess.Popen(
        [node, "server.js"],
        cwd=ROOT,
        env={**os.environ, "PORT": str(LAB_PORT)},
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    for _ in range(60):
        if port_open(LAB_PORT):
            return "started"
        time.sleep(0.5)
    raise RuntimeError("server.js did not start; see server.log")


with st.spinner("Starting the lab server…"):
    try:
        state = start_server()
    except Exception as e:
        st.error(f"Could not start the lab: {e}")
        st.stop()

default_url = os.environ.get("LAB_URL", f"http://localhost:{LAB_PORT}")
with st.sidebar:
    st.header("10-D Market Lab")
    st.caption(f"Node server: {state} on port {LAB_PORT}")
    url = st.text_input("Lab address", default_url,
                        help="Use the phone's hotspot address (e.g. http://10.44.249.195:8080) "
                             "when viewing from another device.")
    height = st.slider("Frame height", 600, 2400, 1400, 100)
    st.link_button("Open in a full tab", url)
    st.caption("Live data from TrueFX, Kraken, Binance and Yahoo. No simulations.")

components.iframe(url, height=height, scrolling=True)
