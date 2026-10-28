"""
Gemini Live API - proxy WebSocket.

Arquitectura (ADN GALIA): el modelo PROPONE, la app (frontend) ARBITRA.
- El backend reenvía audio del cliente a Live y los eventos de Live al cliente.
- Los tool calls viajan al frontend, que los valida contra su estado local
  (propuestas pendientes, ejercicio actual) y responde applied/rejected/cancelled.
- La API key nunca sale del servidor.
"""
import asyncio
import base64
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.core.logging import log

router = APIRouter()

SYSTEM_INSTRUCTION = """Sos GALIA, la asistente de voz de un gimnasio inteligente.
Hablás en español rioplatense, tono cercano, motivador y MUY breve (máximo 2 oraciones por respuesta).
El usuario está entrenando frente a una cámara que cuenta sus repeticiones por visión.

REGLAS DURAS (no negociables):
- NUNCA ejecutes acciones mutantes directamente. Para cambiar de ejercicio o terminar
  la rutina, SIEMPRE llamá primero a la herramienta propose_* correspondiente.
  La aplicación decide si se aplica; vos solo proponés.
- Si el usuario confirma o niega una propuesta que vos hiciste, usá
  confirm_pending_action o cancel_pending_action según corresponda.
- Para mostrar cómo se hace un ejercicio usá show_exercise_example (es de solo lectura).
- Para saber cuántas repeticiones lleva, usá get_rep_count.
- No hables de temas ajenos al entrenamiento; si el usuario divaga, respondé breve y redirigí.
"""

# Herramientas: mutadoras pasan por el gate del frontend; read-only ejecutan directo
LIVE_TOOLS = [{
    "function_declarations": [
        {
            "name": "propose_change_exercise",
            "description": "Proponer cambiar el ejercicio actual a otro disponible en la rutina. Requiere confirmación del usuario.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "exercise_type": {
                        "type": "STRING",
                        "enum": ["squat", "pushup"],
                        "description": "Tipo de ejercicio destino"
                    },
                    "exercise_title": {
                        "type": "STRING",
                        "description": "Nombre visible del ejercicio destino"
                    }
                },
                "required": ["exercise_type"]
            }
        },
        {
            "name": "propose_end_workout",
            "description": "Proponer terminar la rutina actual. Requiere confirmación del usuario.",
            "parameters": {"type": "OBJECT", "properties": {}}
        },
        {
            "name": "confirm_pending_action",
            "description": "Confirmar y ejecutar la propuesta pendiente cuando el usuario la acepta (dijo sí/dale/ok).",
            "parameters": {"type": "OBJECT", "properties": {}}
        },
        {
            "name": "cancel_pending_action",
            "description": "Cancelar la propuesta pendiente cuando el usuario la rechaza o pide otra cosa.",
            "parameters": {"type": "OBJECT", "properties": {}}
        },
        {
            "name": "show_exercise_example",
            "description": "Mostrar la guía visual con el ejemplo de ejecución del ejercicio actual.",
            "parameters": {"type": "OBJECT", "properties": {}}
        },
        {
            "name": "get_rep_count",
            "description": "Consultar cuántas repeticiones lleva el usuario en el ejercicio actual.",
            "parameters": {"type": "OBJECT", "properties": {}}
        }
    ]
}]


@router.websocket("/ws")
async def live_ws(websocket: WebSocket):
    """Proxy bidireccional: browser <-> Gemini Live API."""
    await websocket.accept()
    log("LIVE", "WS cliente conectado")

    if not settings.GEMINI_API_KEY:
        await websocket.send_json({"type": "error", "detail": "GEMINI_API_KEY no configurada en el backend"})
        await websocket.close(code=1011)
        return

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        await websocket.send_json({"type": "error", "detail": "google-genai no instalado en el backend"})
        await websocket.close(code=1011)
        return

    client = genai.Client(
        api_key=settings.GEMINI_API_KEY,
        http_options={"api_version": "v1alpha"},
    )

    config_kwargs: dict = dict(
        response_modalities=["AUDIO"],
        system_instruction=SYSTEM_INSTRUCTION,
        tools=LIVE_TOOLS,
        output_audio_transcription=types.AudioTranscriptionConfig(),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=25600,
            sliding_window=types.SlidingWindow(target_tokens=12800),
        ),
    )

    # speech_config es opcional: si el SDK instalado no soporta estas clases,
    # la sesión Live debe seguir funcionando con la voz default.
    try:
        config_kwargs["speech_config"] = types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=settings.LIVE_VOICE,
                )
            )
        )
    except Exception as e:
        log("LIVE", "speech_config no soportado por el SDK, usando voz default", {"error": str(e)})

    config = types.LiveConnectConfig(**config_kwargs)

    # Reintentar sin speech_config si el connect con voz falla: el servidor Live
    # puede rechazar la config aunque el SDK local la haya parseado bien.
    configs = [config]
    if "speech_config" in config_kwargs:
        fallback_kwargs = dict(config_kwargs)
        fallback_kwargs.pop("speech_config", None)
        configs.append(types.LiveConnectConfig(**fallback_kwargs))

    session_cm = None
    session = None
    for i, cfg in enumerate(configs):
        try:
            cm = client.aio.live.connect(model=settings.LIVE_MODEL, config=cfg)
            session = await cm.__aenter__()
            session_cm = cm
            if i > 0:
                log("LIVE", "Conectado sin speech_config (fallback voz default)")
            break
        except Exception as e:
            log("LIVE", "Connect Live falló", {"attempt": i, "error": str(e)[:300]})
            if i == len(configs) - 1:
                await websocket.send_json({"type": "error", "detail": f"No se pudo conectar a Live: {e}"})
                await websocket.close(code=1011)
                return

    async def _run_session():
            log("LIVE", "Sesión Live conectada", {"model": settings.LIVE_MODEL})
            await websocket.send_json({"type": "ready", "model": settings.LIVE_MODEL})

            async def client_to_live():
                """Browser -> Live: audio PCM 16kHz, tool responses, texto contextual."""
                try:
                    while True:
                        msg = await websocket.receive_json()
                        mtype = msg.get("type")
                        if mtype == "audio":
                            pcm = base64.b64decode(msg["data"])
                            await session.send_realtime_input(
                                audio=types.Blob(data=pcm, mime_type="audio/pcm;rate=16000")
                            )
                        elif mtype == "tool_response":
                            await session.send_tool_response(
                                function_responses=[types.FunctionResponse(
                                    id=msg["id"],
                                    name=msg["name"],
                                    response=msg.get("response") or {},
                                )]
                            )
                        elif mtype == "text":
                            await session.send_client_content(
                                turns=types.Content(
                                    role="user",
                                    parts=[types.Part(text=msg["data"])]
                                ),
                                turn_complete=True,
                            )
                        elif mtype == "close":
                            return
                except WebSocketDisconnect:
                    log("LIVE", "WS cliente desconectado")
                except Exception as e:
                    log("LIVE", "Error en canal cliente->live", {"error": str(e)})

            async def live_to_client():
                """Live -> Browser: audio PCM 24kHz, tool calls, transcripciones, interrupciones."""
                try:
                    while True:
                        async for message in session.receive():
                            sc = message.server_content
                            if sc:
                                if sc.model_turn:
                                    for part in sc.model_turn.parts or []:
                                        if part.inline_data and part.inline_data.data:
                                            await websocket.send_json({
                                                "type": "audio",
                                                "data": base64.b64encode(part.inline_data.data).decode()
                                            })
                                        elif part.text:
                                            await websocket.send_json({"type": "text", "data": part.text})
                                if sc.interrupted:
                                    await websocket.send_json({"type": "interrupted"})
                                if sc.input_transcription and sc.input_transcription.text:
                                    await websocket.send_json({
                                        "type": "input_transcript",
                                        "data": sc.input_transcription.text
                                    })
                                if sc.output_transcription and sc.output_transcription.text:
                                    await websocket.send_json({
                                        "type": "output_transcript",
                                        "data": sc.output_transcription.text
                                    })
                                if sc.turn_complete:
                                    await websocket.send_json({"type": "turn_complete"})
                            if message.tool_call:
                                for fc in message.tool_call.function_calls or []:
                                    log("LIVE", "Tool call de Live", {"name": fc.name, "args": fc.args})
                                    await websocket.send_json({
                                        "type": "tool_call",
                                        "id": fc.id,
                                        "name": fc.name,
                                        "args": dict(fc.args) if fc.args else {},
                                    })
                            if message.tool_call_cancellation:
                                await websocket.send_json({
                                    "type": "tool_cancel",
                                    "ids": list(message.tool_call_cancellation.ids or [])
                                })
                except Exception as e:
                    log("LIVE", "Canal live->cliente terminó", {"error": str(e)})

            done, pending = await asyncio.wait(
                {asyncio.create_task(client_to_live()), asyncio.create_task(live_to_client())},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in done:
                if task.exception():
                    log("LIVE", "Tarea terminó con error", {"error": str(task.exception())})

    try:
        await _run_session()
    except WebSocketDisconnect:
        log("LIVE", "WS cliente desconectado durante sesión Live")
    except Exception as e:
        log("LIVE", "Error en sesión Live", {"error": str(e)})
        try:
            await websocket.send_json({"type": "error", "detail": f"Error en sesión Live: {e}"})
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        if session_cm is not None:
            try:
                await session_cm.__aexit__(None, None, None)
            except Exception:
                pass
