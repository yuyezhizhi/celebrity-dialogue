from pydantic import BaseModel
from typing import Optional


class PhilosopherProfile(BaseModel):
    id: str
    name: str
    era: str
    school: str
    avatar: str = ""
    model: str = "gpt-3.5-turbo"
    provider: str = ""
    api_key: str = ""
    base_url: str = "https://api.openai.com/v1"
    thinking_time: int = 3
    system_prompt: str = ""
    temperature: float = 0.8
    max_tokens: int = 512


class DialogueConfig(BaseModel):
    topic: str
    philosophers: list[PhilosopherProfile]
    max_rounds: int = 10
    conclusion_threshold: float = 0.6


class DialogueMessage(BaseModel):
    philosopher_id: str
    philosopher_name: str
    content: str
    round_number: int
    source: str = "api"
    timestamp: str = ""


class DialogueStatus(BaseModel):
    status: str
    messages: list[DialogueMessage] = []
    current_round: int = 0
    concluded: bool = False
    conclusion_reason: str = ""
