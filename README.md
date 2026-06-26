# AI 名人对话

让不同大模型驱动的思想家、科学家展开思想交锋。

## 功能

- 28 位名人可选（苏格拉底、尼采、老子、爱因斯坦、图灵等），涵盖哲学、科学、军事、经济
- 每位名人可独立配置 LLM 模型、API Key、思考时间
- 实时 WebSocket 对话，多轮辩论直至达成共识或达到最大轮次
- 全屏角色思考动画（每位名人独有的视觉风格）
- 主题锚定机制，防止讨论偏离
- 对话导出、sessionStorage 状态恢复

## 快速启动

```bash
pip install -r requirements.txt
python main.py
```

访问 http://localhost:8000

默认使用环境变量注入 API Key：

- `MCAI_LLM_API_KEY`
- `MCAI_LLM_BASE_URL`
- `MCAI_LLM_MODEL`
- `MCAI_MODEL_PROVIDER_TYPE`（`anthropic` 或空/`openai`）

无 API Key 时自动降级为模拟回复。

## 技术栈

- FastAPI + WebSocket
- 纯 HTML/CSS/JS 前端
- Anthropic / OpenAI 双协议
