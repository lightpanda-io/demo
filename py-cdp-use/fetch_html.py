#!/usr/bin/env python3
"""Fetch final HTML of a URL via CDP using cdp-use."""
import argparse
import asyncio
import sys

from cdp_use.client import CDPClient


async def fetch_html(
    url: str, browser_ws: str, wait_networkidle: bool, timeout: float
) -> str:
    client = CDPClient(browser_ws)
    await client.start()
    try:
        target = await client.send.Target.createTarget({"url": "about:blank"})
        target_id = target["targetId"]
        try:
            attached = await client.send.Target.attachToTarget(
                {"targetId": target_id, "flatten": True}
            )
            session_id = attached["sessionId"]

            load_event = asyncio.Event()
            idle_event = asyncio.Event()

            def on_load(_event, _sid=None):
                load_event.set()

            def on_lifecycle(event, _sid=None):
                if event.get("name") == "networkAlmostIdle":
                    idle_event.set()

            client.register.Page.loadEventFired(on_load)
            client.register.Page.lifecycleEvent(on_lifecycle)

            await client.send.Page.enable(session_id=session_id)
            if wait_networkidle:
                await client.send.Page.setLifecycleEventsEnabled(
                    {"enabled": True}, session_id=session_id
                )

            await client.send.Page.navigate({"url": url}, session_id=session_id)

            waiter = idle_event.wait() if wait_networkidle else load_event.wait()
            try:
                await asyncio.wait_for(waiter, timeout=timeout)
            except asyncio.TimeoutError:
                print(f"timeout after {timeout}s, returning current HTML", file=sys.stderr)

            doc = await client.send.DOM.getDocument({}, session_id=session_id)
            html = await client.send.DOM.getOuterHTML(
                {"nodeId": doc["root"]["nodeId"]}, session_id=session_id
            )
            return html["outerHTML"]
        finally:
            await client.send.Target.closeTarget({"targetId": target_id})
    finally:
        await client.stop()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("url")
    p.add_argument("--ws", default="ws://127.0.0.1:9222/", help="CDP WebSocket URL")
    p.add_argument("--wait-networkidle", action="store_true")
    p.add_argument("--timeout", type=float, default=30.0)
    args = p.parse_args()

    html = asyncio.run(
        fetch_html(args.url, args.ws, args.wait_networkidle, args.timeout)
    )
    sys.stdout.write(html)


if __name__ == "__main__":
    main()
