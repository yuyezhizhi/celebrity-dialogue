#!/bin/bash
# 启动 AI 哲学家对话系统
cd /workspace
exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload
