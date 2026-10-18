"""
EventPilot uAgent — exposes the planner on Agentverse so it can be discovered via ASI:One.

Run:
  pip install -r requirements.txt
  EVENTPILOT_URL=https://<your-deploy>/api/agent AGENT_SEED="some long secret phrase" python eventpilot_agent.py
Then register the agent's mailbox in Agentverse (link printed on startup).
"""
import os
from datetime import datetime
from uuid import uuid4

import requests
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

EVENTPILOT_URL = os.getenv("EVENTPILOT_URL", "http://localhost:3000/api/agent")

agent = Agent(
    name="eventpilot",
    seed=os.getenv("AGENT_SEED", "eventpilot dev seed change me"),
    port=8001,
    mailbox=True,
    publish_agent_details=True,
)
chat = Protocol(spec=chat_protocol_spec)


def reply(text: str) -> ChatMessage:
    return ChatMessage(
        timestamp=datetime.utcnow(),
        msg_id=uuid4(),
        content=[TextContent(type="text", text=text), EndSessionContent(type="end-session")],
    )


@chat.on_message(ChatMessage)
async def handle(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.utcnow(), acknowledged_msg_id=msg.msg_id))
    prompt = " ".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
    if not prompt:
        return
    ctx.logger.info(f"Planning for {sender}: {prompt[:80]}")
    try:
        r = requests.post(EVENTPILOT_URL, json={"prompt": prompt}, timeout=120)
        r.raise_for_status()
        await ctx.send(sender, reply(r.json()["markdown"]))
    except Exception as e:  # noqa: BLE001
        await ctx.send(sender, reply(f"Sorry, the planning crew hit an error: {e}"))


@chat.on_message(ChatAcknowledgement)
async def ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


agent.include(chat, publish_manifest=True)

if __name__ == "__main__":
    agent.run()
