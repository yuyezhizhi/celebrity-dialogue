import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from models import PhilosopherProfile, DialogueConfig, DialogueMessage, DialogueStatus
from config import DEFAULT_PHILOSOPHERS, OPENAI_COMPATIBLE_MODELS
from dialogue_engine import run_dialogue

active_sessions: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    active_sessions.clear()


app = FastAPI(title="AI 哲学家对话系统", lifespan=lifespan)

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/api/philosophers")
async def get_philosophers():
    return [p.model_dump() for p in DEFAULT_PHILOSOPHERS]


@app.get("/api/models")
async def get_models():
    return OPENAI_COMPATIBLE_MODELS


@app.post("/api/philosophers/update")
async def update_philosopher(philosopher: PhilosopherProfile):
    return {"status": "ok", "philosopher": philosopher.model_dump()}


@app.websocket("/ws/dialogue")
async def dialogue_ws(websocket: WebSocket):
    await websocket.accept()

    try:
        data = await websocket.receive_text()
        config_data = json.loads(data)
        config = DialogueConfig(**config_data)

        session_id = str(id(websocket))
        active_sessions[session_id] = {"status": "running", "cancelled": False}

        async def on_message(msg: DialogueMessage):
            try:
                await websocket.send_json({
                    "type": "message",
                    "data": msg.model_dump(),
                })
            except Exception:
                pass

        async def on_typing(info: dict):
            try:
                await websocket.send_json({
                    "type": "typing",
                    "data": info,
                })
            except Exception:
                pass

        async def on_summary(summary: str):
            try:
                await websocket.send_json({
                    "type": "summary",
                    "data": {"content": summary},
                })
            except Exception:
                pass

        try:
            messages = await run_dialogue(
                philosophers=config.philosophers,
                topic=config.topic,
                max_rounds=config.max_rounds,
                on_message=on_message,
                on_typing=on_typing,
                on_summary=on_summary,
            )

            await websocket.send_json({
                "type": "done",
                "data": {
                    "total_messages": len(messages),
                    "total_rounds": messages[-1].round_number if messages else 0,
                },
            })
        except asyncio.CancelledError:
            pass
        finally:
            active_sessions.pop(session_id, None)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({
                "type": "error",
                "data": {"message": str(e)},
            })
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
