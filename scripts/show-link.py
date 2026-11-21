"""Publish a locally sampled Ableton Link session to Ink Studio over loopback OSC."""
import argparse
import asyncio
import socket
import struct


async def run(args):
    try:
        from aalink import Link
    except ImportError as error:
        raise SystemExit("Install aalink in a Python environment before starting the Link companion") from error
    link = Link(args.tempo)
    link.start_stop_sync_enabled = True
    link.enabled = True
    print(f"Ableton Link → Ink OSC 127.0.0.1:{args.port}", flush=True)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
        try:
            while True:
                packet = b"/ink/link\0\0\0" + b",ffii\0\0\0" + struct.pack(
                    ">ffii", link.tempo, link.beat, int(link.playing), link.num_peers
                )
                sender.sendto(packet, ("127.0.0.1", args.port))
                await asyncio.sleep(1 / 30)
        finally:
            link.enabled = False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=9002)
    parser.add_argument("--tempo", type=float, default=120)
    config = parser.parse_args()
    if not 1 <= config.port <= 65535 or not 20 <= config.tempo <= 400:
        parser.error("Choose a UDP port from 1–65535 and a tempo from 20–400 BPM")
    try:
        asyncio.run(run(config))
    except KeyboardInterrupt:
        pass
